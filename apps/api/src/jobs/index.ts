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
