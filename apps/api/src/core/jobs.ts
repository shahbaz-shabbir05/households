/**
 * Background jobs.
 *
 * Every job is an *idempotent sweep over current state*, never a queue
 * consumer. That property is what lets this run in-process with no broker: if
 * the app is down for six hours, the next run simply catches up (docs/05).
 *
 * Concurrency across instances is handled by a Postgres advisory lock, so
 * running several app instances is safe without a leader election.
 */

import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { getPool } from '../db/client.js';
import { jobRuns } from '../db/schema/index.js';

export interface JobContext {
  db: Database;
  now: Date;
  log: JobLogger;
}

export interface JobLogger {
  info(meta: Record<string, unknown>, message: string): void;
  warn(meta: Record<string, unknown>, message: string): void;
  error(meta: Record<string, unknown>, message: string): void;
}

export interface JobDefinition {
  name: string;
  /** How often to run, in milliseconds. */
  intervalMs: number;
  /** Returns the number of items processed, for the run record. */
  run(ctx: JobContext): Promise<number>;
}

/** A stable 64-bit key per job name, for `pg_try_advisory_lock`. */
function lockKey(name: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(name)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  // Advisory locks take a signed bigint.
  return BigInt.asIntN(64, hash);
}

export class JobRunner {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly log: JobLogger,
    private readonly jobs: JobDefinition[],
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;

    for (const job of this.jobs) {
      const timer = setInterval(() => {
        void this.runOnce(job);
      }, job.intervalMs);
      // Never hold the process open just for a scheduler tick.
      timer.unref?.();
      this.timers.set(job.name, timer);
    }

    this.log.info({ jobs: this.jobs.map((j) => j.name) }, 'job scheduler started');
  }

  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.running = false;
  }

  /**
   * Runs one job under an advisory lock, recording the outcome. Exposed so
   * tests can drive a job deterministically rather than waiting on a timer.
   */
  async runOnce(job: JobDefinition, now: Date = new Date()): Promise<number | null> {
    const key = lockKey(job.name);

    // Advisory locks belong to a *session*, so the lock and the unlock must run
    // on the same connection. Taking a dedicated client from the pool and
    // holding it for the job's duration is what guarantees that — issuing both
    // through the pool can land them on different connections and leak the lock.
    const client = await getPool().connect();
    let locked = false;

    try {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1::bigint) AS locked',
        [key.toString()],
      );
      locked = result.rows[0]?.locked === true;
      if (!locked) {
        // Another instance is already on it. Not an error.
        return null;
      }
      return await this.execute(job, now);
    } finally {
      // The release gets its own finally: awaiting the unlock in the same block
      // means a failed unlock (connection reset, statement timeout, pool
      // shutdown) propagates before the client is returned, and a handful of
      // those exhausts the pool until every request hangs.
      try {
        if (locked) {
          await client.query('SELECT pg_advisory_unlock($1::bigint)', [key.toString()]);
        }
      } catch (error) {
        // A lock on a connection that is about to be released is released with
        // it, so this is worth recording but never worth failing the run.
        this.log.warn(
          { job: job.name, err: error instanceof Error ? error.message : String(error) },
          'advisory unlock failed; releasing the connection anyway',
        );
      } finally {
        client.release();
      }
    }
  }

  private async execute(job: JobDefinition, now: Date): Promise<number> {
    const [run] = await this.db
      .insert(jobRuns)
      .values({ jobName: job.name, startedAt: now, status: 'running' })
      .returning({ id: jobRuns.id });

    try {
      const processed = await job.run({ db: this.db, now, log: this.log });
      await this.db
        .update(jobRuns)
        .set({ status: 'succeeded', finishedAt: new Date(), itemsProcessed: processed })
        .where(eq(jobRuns.id, run!.id));
      if (processed > 0) this.log.info({ job: job.name, processed }, 'job completed');
      return processed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.db
        .update(jobRuns)
        .set({ status: 'failed', finishedAt: new Date(), error: message })
        .where(eq(jobRuns.id, run!.id));
      // Logged, not rethrown: one failing job must not stop the scheduler.
      this.log.error({ job: job.name, err: message }, 'job failed');
      return 0;
    }
  }
}
