/**
 * Integration-test harness.
 *
 * Tests run against a real Postgres database, not a mock and not SQLite. The
 * bugs this product will actually have live in the seams — tenant scoping,
 * authorization, transactions, timezone maths — and a mocked database passes
 * every one of them while they are broken (docs/12).
 */

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import type { Container } from '../container.js';
import { closeDb, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { MemoryMailer } from '../core/mailer.js';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '../http/session.js';

let migrated = false;

export interface TestApp {
  app: FastifyInstance;
  container: Container;
  mailer: MemoryMailer;
  /** Advance or freeze time for date-dependent behaviour. */
  setNow(date: Date): void;
}

export async function createTestApp(): Promise<TestApp> {
  if (!migrated) {
    await runMigrations();
    migrated = true;
  }
  await truncateAll();

  const mailer = new MemoryMailer();
  let now = new Date();

  const { app, container } = await buildApp({
    mailer,
    now: () => now,
  });
  await app.ready();

  return {
    app,
    container,
    mailer,
    setNow(date) {
      now = date;
    },
  };
}

/**
 * Truncates every table between tests. `RESTART IDENTITY CASCADE` in one
 * statement is faster than per-table deletes and cannot leave orphans behind.
 * The migrations table is preserved so migrations run once per process.
 */
export async function truncateAll(): Promise<void> {
  const db = getDb();
  const { rows } = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'
  `);
  if (rows.length === 0) return;

  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
}

export async function closeTestApp(test: TestApp): Promise<void> {
  await test.app.close();
}

export async function shutdownTestDatabase(): Promise<void> {
  await closeDb();
}

/**
 * A browser-like client: it holds cookies across requests and echoes the CSRF
 * token, so tests exercise the same path a real client takes rather than a
 * bypass.
 */
export class Agent {
  private cookies = new Map<string, string>();

  constructor(private readonly app: FastifyInstance) {}

  get sessionCookie(): string | undefined {
    return this.cookies.get(SESSION_COOKIE);
  }

  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
    options: { csrf?: boolean } = {},
  ) {
    const headers: Record<string, string> = {};

    const cookieHeader = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookieHeader) headers.cookie = cookieHeader;

    const csrf = this.cookies.get(CSRF_COOKIE);
    if (csrf && options.csrf !== false) headers[CSRF_HEADER] = csrf;

    const response = await this.app.inject({
      method,
      url,
      headers,
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });

    this.captureCookies(response.headers['set-cookie']);
    return response;
  }

  get = (url: string) => this.request('GET', url);
  post = (url: string, payload?: unknown, options?: { csrf?: boolean }) =>
    this.request('POST', url, payload, options);
  patch = (url: string, payload?: unknown) => this.request('PATCH', url, payload);
  delete = (url: string) => this.request('DELETE', url);

  private captureCookies(header: string | string[] | undefined): void {
    if (!header) return;
    for (const raw of Array.isArray(header) ? header : [header]) {
      const [pair] = raw.split(';');
      const index = pair?.indexOf('=') ?? -1;
      if (index <= 0 || !pair) continue;
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

/**
 * Runs one background job once, deterministically.
 *
 * The production runner swallows job errors on purpose — one failing job must
 * not stop the scheduler — which would make a broken job look like "0 items
 * processed" in a test. This helper reads back the recorded run and fails
 * loudly instead.
 */
export async function runJobOnce(test: TestApp, name: string, at: Date): Promise<number | null> {
  const { buildJobs } = await import('../jobs/index.js');
  const { JobRunner } = await import('../core/jobs.js');
  const { jobRuns } = await import('../db/schema/index.js');
  const { desc, eq } = await import('drizzle-orm');

  const job = buildJobs(test.container).find((j) => j.name === name);
  if (!job) throw new Error(`No job registered called "${name}"`);

  const silentLog = { info: () => {}, warn: () => {}, error: () => {} };
  const processed = await new JobRunner(test.container.db, silentLog, [job]).runOnce(job, at);

  const [run] = await test.container.db
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.jobName, name))
    .orderBy(desc(jobRuns.startedAt))
    .limit(1);

  if (run?.status === 'failed') {
    throw new Error(`Job "${name}" failed: ${run.error}`);
  }
  return processed;
}
