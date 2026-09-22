/**
 * Cross-cutting platform tables: audit, attachments, notifications, recurrence
 * and job bookkeeping. Every module uses these; no module owns them.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  AUDIT_ACTIONS,
  ENTITY_TYPES,
  NOTIFICATION_CHANNELS,
  PRIORITIES,
  type AuditAction,
  type EntityType,
  type NotificationChannel,
  type Priority,
  type RecurrenceFreq,
} from '@hms/shared';
import { households, householdMembers, users } from './identity.js';
import { primaryId, timestamps } from './_shared.js';

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(', ')})`);

/**
 * Written in the same transaction as the change it records, from the service
 * layer. `changes` holds only the fields that actually differed (docs/13).
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorMemberId: uuid('actor_member_id').references(() => householdMembers.id, { onDelete: 'set null' }),
    entityType: text('entity_type').$type<EntityType>().notNull(),
    entityId: uuid('entity_id'),
    action: text('action').$type<AuditAction>().notNull(),
    changes: jsonb('changes').$type<Record<string, { from: unknown; to: unknown }>>(),
    summary: text('summary'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.householdId, t.entityType, t.entityId),
    index('audit_logs_recent_idx').on(t.householdId, t.createdAt.desc()),
    index('audit_logs_actor_idx').on(t.actorUserId, t.createdAt.desc()),
    check('audit_logs_action_chk', inList('action', AUDIT_ACTIONS)),
    check('audit_logs_entity_type_chk', inList('entity_type', ENTITY_TYPES)),
  ],
);

/**
 * File metadata only — blobs live in object storage (docs/10). `storageKey` is
 * opaque and unguessable; the original filename is kept for display only.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').$type<EntityType>(),
    entityId: uuid('entity_id'),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    /** Set when the owning entity is deleted; a daily job purges after a grace period. */
    pendingDeleteAt: timestamp('pending_delete_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('attachments_storage_key_uq').on(t.storageKey),
    index('attachments_owner_idx').on(t.householdId, t.entityType, t.entityId),
    index('attachments_pending_delete_idx').on(t.pendingDeleteAt).where(sql`pending_delete_at IS NOT NULL`),
    check('attachments_size_chk', sql`${t.sizeBytes} > 0`),
  ],
);

/**
 * A system-generated message. Distinct from a reminder, which is a user-created
 * intention — see docs/09.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull().references(() => householdMembers.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    entityType: text('entity_type').$type<EntityType>(),
    entityId: uuid('entity_id'),
    priority: text('priority').$type<Priority>().notNull().default('normal'),
    /** Collapses repeats: an overdue bill produces one notification, not one per day. */
    dedupeKey: text('dedupe_key'),
    /** Set when generated inside quiet hours; the dispatcher releases it later. */
    deferredUntil: timestamp('deferred_until', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('notifications_dedupe_uq')
      .on(t.householdId, t.memberId, t.dedupeKey)
      .where(sql`dedupe_key IS NOT NULL`),
    index('notifications_inbox_idx').on(t.memberId, t.createdAt.desc()),
    index('notifications_unread_idx').on(t.memberId).where(sql`read_at IS NULL`),
    check('notifications_priority_chk', inList('priority', PRIORITIES)),
  ],
);

/** One row per channel attempt, so "did they actually get told?" is answerable. */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: primaryId(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    channel: text('channel').$type<NotificationChannel>().notNull(),
    status: text('status').$type<'pending' | 'sent' | 'failed' | 'skipped'>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('notification_deliveries_uq').on(t.notificationId, t.channel),
    index('notification_deliveries_pending_idx').on(t.status).where(sql`status = 'pending'`),
    check('notification_deliveries_channel_chk', inList('channel', NOTIFICATION_CHANNELS)),
  ],
);

/** An RFC 5545 subset (docs/08). Shared by every recurring entity. */
export const recurrenceRules = pgTable(
  'recurrence_rules',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    freq: text('freq').$type<RecurrenceFreq>().notNull(),
    interval: integer('interval').notNull().default(1),
    byWeekday: smallint('by_weekday').array(),
    byMonthday: smallint('by_monthday').array(),
    byMonth: smallint('by_month').array(),
    until: text('until'),
    count: integer('count'),
    ...timestamps,
  },
  (t) => [
    check('recurrence_rules_freq_chk', inList('freq', ['daily', 'weekly', 'monthly', 'yearly'])),
    check('recurrence_rules_interval_chk', sql`${t.interval} >= 1`),
    // A series ends by date or by count — never both (docs/08).
    check('recurrence_rules_bound_chk', sql`NOT (${t.until} IS NOT NULL AND ${t.count} IS NOT NULL)`),
  ],
);

/**
 * The generic series. `entityType` selects a materialiser registered in code;
 * `template` is the payload it renders, validated by that module's Zod schema
 * on write and on read.
 */
export const recurringSeries = pgTable(
  'recurring_series',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').$type<EntityType>().notNull(),
    recurrenceRuleId: uuid('recurrence_rule_id')
      .notNull()
      .references(() => recurrenceRules.id, { onDelete: 'cascade' }),
    template: jsonb('template').$type<Record<string, unknown>>().notNull(),
    anchorDate: text('anchor_date').notNull(),
    /** Rolling horizon: occurrences exist up to here and no further (docs/08). */
    generateThrough: text('generate_through'),
    lastGeneratedOn: text('last_generated_on'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('recurring_series_active_idx').on(t.isActive, t.lastGeneratedOn).where(sql`is_active`),
    index('recurring_series_household_idx').on(t.householdId, t.entityType),
    check('recurring_series_entity_type_chk', inList('entity_type', ENTITY_TYPES)),
  ],
);

/**
 * The idempotency ledger. The unique constraint here — not careful code — is
 * what guarantees a recurring item is never duplicated, however many times the
 * generator runs or crashes mid-way (docs/08).
 */
export const seriesOccurrences = pgTable(
  'series_occurrences',
  {
    id: primaryId(),
    seriesId: uuid('series_id').notNull().references(() => recurringSeries.id, { onDelete: 'cascade' }),
    occurrenceDate: text('occurrence_date').notNull(),
    entityId: uuid('entity_id'),
    /** Tombstone: a user-deleted occurrence must not be resurrected by the next run. */
    skippedAt: timestamp('skipped_at', { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex('series_occurrences_uq').on(t.seriesId, t.occurrenceDate)],
);

/**
 * Job bookkeeping. A reminder job that silently stops running is the worst
 * failure this product can have, so runs are recorded and observable (docs/05).
 */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: primaryId(),
    jobName: text('job_name').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: text('status').$type<'running' | 'succeeded' | 'failed' | 'skipped'>().notNull().default('running'),
    itemsProcessed: integer('items_processed').notNull().default(0),
    error: text('error'),
  },
  (t) => [index('job_runs_name_idx').on(t.jobName, t.startedAt.desc())],
);
