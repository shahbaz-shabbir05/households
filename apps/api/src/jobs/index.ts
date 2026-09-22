/**
 * Job registration (docs/05).
 *
 * Phase 1 ships the two jobs the platform itself needs. Later phases add
 * recurrence generation and the daily scans by appending to this list — the
 * runner and its locking never change.
 */

import { and, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { sessions, userTokens } from '../db/schema/index.js';
import { JobRunner, type JobDefinition } from '../core/jobs.js';
import type { Container } from '../container.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function buildJobs(container: Container): JobDefinition[] {
  return [
    {
      // Materialises upcoming occurrences for every active series. Idempotent
      // by construction: the series_occurrences unique index means a second
      // run in the same window creates nothing (docs/08).
      name: 'generateRecurrences',
      intervalMs: 15 * MINUTE,
      run: async ({ db, now }) => {
        const { loadSeriesDueForGeneration, generateForSeries } = await import(
          '../core/recurrence-service.js'
        );

        let created = 0;
        // "Already generated today" is evaluated per household, in SQL, against
        // that household's own timezone — passing one server-side date would be
        // a day out for anyone east or west of it.
        for (const series of await loadSeriesDueForGeneration(db, now)) {
          const materialiser = container.materialisers.get(series.entityType);
          if (!materialiser) continue;
          created += await db.transaction((tx) => generateForSeries(tx, series, materialiser, now));
        }
        return created;
      },
    },
    {
      // Turns due reminders into notifications.
      name: 'dispatchReminders',
      intervalMs: MINUTE,
      run: async ({ db, now }) => container.reminders.dispatchDue(db, now),
    },
    {
      // Recomputes bill status and raises due/overdue notices. Hourly: a bill
      // becoming overdue is a date boundary, not a minute-by-minute event.
      name: 'refreshBillStatuses',
      intervalMs: HOUR,
      run: async ({ db, now }) => container.bills.refreshAndNotify(db, now),
    },
    {
      name: 'dispatchNotifications',
      intervalMs: MINUTE,
      run: async ({ db }) => container.notifications.dispatchPending(db),
    },
    {
      name: 'cleanupExpiredCredentials',
      intervalMs: 24 * HOUR,
      run: async ({ db, now }) => {
        // Expired sessions and consumed tokens are dead weight and a small
        // liability; there is no reason to keep them.
        const cutoff = new Date(now.getTime() - 30 * 24 * HOUR);
        const removedSessions = await db
          .delete(sessions)
          .where(or(lt(sessions.expiresAt, now), and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, cutoff))))
          .returning({ id: sessions.id });

        const removedTokens = await db
          .delete(userTokens)
          .where(or(lt(userTokens.expiresAt, now), isNotNull(userTokens.consumedAt)))
          .returning({ id: userTokens.id });

        return removedSessions.length + removedTokens.length;
      },
    },
  ];
}

export function createJobRunner(container: Container, log: FastifyBaseLogger): JobRunner {
  return new JobRunner(container.db, log, buildJobs(container));
}

export { sql };
