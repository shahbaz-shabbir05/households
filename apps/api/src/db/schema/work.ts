/**
 * Tasks (including chores), events and reminders.
 *
 * Chores are not a separate table: a chore is a recurring, assigned task, and
 * two tables would mean two recurrence integrations, two completion flows and
 * two overdue queries that drift apart (docs/01).
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ENTITY_TYPES,
  EVENT_TYPES,
  PRIORITIES,
  REMINDER_STATUSES,
  TASK_CATEGORIES,
  TASK_STATUSES,
  type EntityType,
  type EventType,
  type Priority,
  type ReminderStatus,
  type TaskCategory,
  type TaskStatus,
} from '@hms/shared';
import { households, householdMembers } from './identity.js';
import { recurringSeries } from './platform.js';
import { authorship, primaryId, softDelete, timestamps } from './_shared.js';

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(', ')})`);

export const tasks = pgTable(
  'tasks',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').$type<TaskStatus>().notNull().default('pending'),
    priority: text('priority').$type<Priority>().notNull().default('normal'),
    category: text('category').$type<TaskCategory>().notNull().default('other'),

    assigneeMemberId: uuid('assignee_member_id').references(() => householdMembers.id, {
      onDelete: 'set null',
    }),
    /** Who added it — drives the `own` policy scope for teens and children. */
    createdByMemberId: uuid('created_by_member_id').references(() => householdMembers.id, {
      onDelete: 'set null',
    }),

    /** A civil date: "due Tuesday" is true regardless of timezone (docs/04). */
    dueDate: text('due_date'),
    /** `HH:MM` when the task is time-specific; null means any time that day. */
    dueTime: text('due_time'),
    startDate: text('start_date'),
    estimatedMinutes: integer('estimated_minutes'),

    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedByMemberId: uuid('completed_by_member_id').references(() => householdMembers.id, {
      onDelete: 'set null',
    }),

    seriesId: uuid('series_id').references(() => recurringSeries.id, { onDelete: 'set null' }),
    occurrenceDate: text('occurrence_date'),
    /** Set when a user edits one occurrence of a series in isolation (docs/08). */
    isDetached: boolean('is_detached').notNull().default(false),

    notes: text('notes'),
    ...timestamps,
    ...softDelete,
    ...authorship,
  },
  (t) => [
    // The dashboard's hot path.
    index('tasks_due_idx').on(t.householdId, t.status, t.dueDate).where(sql`deleted_at IS NULL`),
    index('tasks_assignee_idx')
      .on(t.householdId, t.assigneeMemberId, t.status, t.dueDate)
      .where(sql`deleted_at IS NULL`),
    index('tasks_category_idx').on(t.householdId, t.category).where(sql`deleted_at IS NULL`),
    // One task per occurrence, belt-and-braces alongside series_occurrences.
    uniqueIndex('tasks_series_occurrence_uq')
      .on(t.seriesId, t.occurrenceDate)
      .where(sql`series_id IS NOT NULL`),
    check('tasks_status_chk', inList('status', TASK_STATUSES)),
    check('tasks_priority_chk', inList('priority', PRIORITIES)),
    check('tasks_category_chk', inList('category', TASK_CATEGORIES)),
    // A completed task must record when it was completed.
    check('tasks_completed_chk', sql`${t.status} <> 'completed' OR ${t.completedAt} IS NOT NULL`),
    check('tasks_due_time_chk', sql`${t.dueTime} IS NULL OR ${t.dueTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
  ],
);

/**
 * Calendar events.
 *
 * Stored as civil date + optional time rather than a bare `timestamptz`,
 * because the dominant event types in a household — birthdays, anniversaries,
 * holidays — are date-only. Forcing them through an instant is how a birthday
 * ends up a day early for half the family. Timed events carry `startTime`, and
 * `core/time` converts to an instant in the household timezone when needed.
 */
export const events = pgTable(
  'events',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    eventType: text('event_type').$type<EventType>().notNull().default('other'),

    startDate: text('start_date').notNull(),
    startTime: text('start_time'),
    endDate: text('end_date'),
    endTime: text('end_time'),
    isAllDay: boolean('is_all_day').notNull().default(true),

    location: text('location'),
    createdByMemberId: uuid('created_by_member_id').references(() => householdMembers.id, {
      onDelete: 'set null',
    }),

    seriesId: uuid('series_id').references(() => recurringSeries.id, { onDelete: 'set null' }),
    occurrenceDate: text('occurrence_date'),
    isDetached: boolean('is_detached').notNull().default(false),

    ...timestamps,
    ...softDelete,
    ...authorship,
  },
  (t) => [
    index('events_range_idx').on(t.householdId, t.startDate).where(sql`deleted_at IS NULL`),
    index('events_type_idx').on(t.householdId, t.eventType).where(sql`deleted_at IS NULL`),
    uniqueIndex('events_series_occurrence_uq')
      .on(t.seriesId, t.occurrenceDate)
      .where(sql`series_id IS NOT NULL`),
    check('events_type_chk', inList('event_type', EVENT_TYPES)),
    check('events_order_chk', sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`),
    check('events_all_day_chk', sql`NOT ${t.isAllDay} OR ${t.startTime} IS NULL`),
  ],
);

/** Who is expected at an event. */
export const eventParticipants = pgTable(
  'event_participants',
  {
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull().references(() => householdMembers.id, { onDelete: 'cascade' }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.memberId] }),
    index('event_participants_member_idx').on(t.memberId),
  ],
);

/**
 * A reminder is a *user-created intention* ("tell me about X at time T"),
 * distinct from a notification, which is the system-generated message that
 * results (docs/09).
 *
 * `remindAt` is an instant because the dispatcher sweeps globally across
 * households; it is computed from the household's timezone at write time.
 */
export const reminders = pgTable(
  'reminders',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body'),

    /** Optional link to whatever the reminder is about. */
    entityType: text('entity_type').$type<EntityType>(),
    entityId: uuid('entity_id'),

    remindAt: timestamp('remind_at', { withTimezone: true }).notNull(),
    /** Kept so the UI can show what the user actually typed, free of timezone maths. */
    remindOnDate: text('remind_on_date').notNull(),
    remindAtTime: text('remind_at_time').notNull(),

    assigneeMemberId: uuid('assignee_member_id').references(() => householdMembers.id, {
      onDelete: 'cascade',
    }),
    createdByMemberId: uuid('created_by_member_id').references(() => householdMembers.id, {
      onDelete: 'set null',
    }),

    priority: text('priority').$type<Priority>().notNull().default('normal'),
    status: text('status').$type<ReminderStatus>().notNull().default('pending'),
    firedAt: timestamp('fired_at', { withTimezone: true }),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),

    seriesId: uuid('series_id').references(() => recurringSeries.id, { onDelete: 'set null' }),
    occurrenceDate: text('occurrence_date'),

    ...timestamps,
    ...softDelete,
    ...authorship,
  },
  (t) => [
    index('reminders_household_idx').on(t.householdId, t.status, t.remindAt).where(sql`deleted_at IS NULL`),
    // The dispatcher's sweep is global, so this index is deliberately not
    // household-scoped (docs/04).
    index('reminders_pending_global_idx')
      .on(t.remindAt)
      .where(sql`status = 'pending' AND deleted_at IS NULL`),
    uniqueIndex('reminders_series_occurrence_uq')
      .on(t.seriesId, t.occurrenceDate)
      .where(sql`series_id IS NOT NULL`),
    check('reminders_status_chk', inList('status', REMINDER_STATUSES)),
    check('reminders_priority_chk', inList('priority', PRIORITIES)),
    check('reminders_entity_chk', sql`${t.entityType} IS NULL OR ${t.entityType} IN (${sql.raw(ENTITY_TYPES.map((v) => `'${v}'`).join(', '))})`),
  ],
);
