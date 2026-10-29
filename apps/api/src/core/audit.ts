/**
 * Audit logging.
 *
 * Written from the service layer, inside the same transaction as the change it
 * records — so an audit entry cannot exist for a change that rolled back, and a
 * change cannot slip through unrecorded (docs/13).
 */

import type { AuditAction, EntityType } from '@hms/shared';
import { auditLogs } from '../db/schema/index.js';
import type { DbExecutor } from '../db/client.js';
import type { RequestContext } from './request-context.js';

/** Never recorded, even in a before/after diff. */
const REDACTED_FIELDS = new Set([
  'passwordHash',
  'password',
  'tokenHash',
  'token',
  'documentNumber',
]);

export interface AuditEntry {
  entityType: EntityType;
  entityId?: string | null;
  action: AuditAction;
  /** Only the fields that actually differed; computed by `diffFields`. */
  changes?: Record<string, { from: unknown; to: unknown }> | null;
  summary?: string | null;
}

export async function writeAudit(
  db: DbExecutor,
  ctx: RequestContext,
  entry: AuditEntry,
): Promise<void> {
  await db.insert(auditLogs).values({
    householdId: ctx.household.id,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.member.id,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    action: entry.action,
    changes: entry.changes ?? null,
    summary: entry.summary ?? null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
  });
}

/**
 * Produces a minimal before/after diff.
 *
 * Only changed fields are stored: a full row snapshot on every update would
 * bloat the table and bury the one field that actually moved. Values are
 * compared by JSON equality so Dates and arrays behave sensibly.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: Partial<T>,
): Record<string, { from: unknown; to: unknown }> | null {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const [key, next] of Object.entries(after)) {
    if (REDACTED_FIELDS.has(key)) continue;
    if (next === undefined) continue;

    const previous = before?.[key];
    if (equalish(previous, next)) continue;

    changes[key] = { from: redact(key, previous), to: redact(key, next) };
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

function redact(key: string, value: unknown): unknown {
  return REDACTED_FIELDS.has(key) ? '[redacted]' : value;
}

function equalish(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // null and undefined both mean "not set" as far as a diff is concerned.
  if (a == null && b == null) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as string).getTime() === new Date(b as string).getTime();
  }
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}
