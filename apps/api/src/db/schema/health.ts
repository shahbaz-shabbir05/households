/**
 * Health: doctors, appointments, medicines and their dose schedule.
 *
 * SAFETY RULE, enforced by this schema's shape as much as by code:
 * this module **records and reminds**. It never suggests, computes, converts
 * or alters a dose. `doseText` and `frequencyText` are free text, stored and
 * displayed exactly as the person typed them off the prescription — they are
 * deliberately not parsed into structured amounts, because a parser that is
 * wrong about a dose is worse than no parser at all (docs/00, docs/01 §9).
 *
 * The one thing the system does derive is *when to remind*, from an explicit
 * list of times the user enters. It never infers times from the frequency
 * text.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { households, householdMembers } from './identity.js';
import { recurringSeries } from './platform.js';
import { authorship, primaryId, softDelete, timestamps } from './_shared.js';

const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'rescheduled'] as const;
const DOSE_STATUSES = ['due', 'taken', 'skipped', 'missed'] as const;

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(', ')})`);

export const doctors = pgTable(
  'doctors',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    specialty: text('specialty'),
    clinic: text('clinic'),
    phone: text('phone'),
    address: text('address'),
    notes: text('notes'),
    ...timestamps,
    ...softDelete,
    ...authorship,
  },
  (t) => [
    index('doctors_household_idx').on(t.householdId).where(sql`deleted_at IS NULL`),
    uniqueIndex('doctors_name_uq')
      .on(t.householdId, sql`lower(${t.name})`)
      .where(sql`deleted_at IS NULL`),
  ],
);

export const appointments = pgTable(
  'appointments',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    /** Who the appointment is for. */
    memberId: uuid('member_id')
      .notNull()
      .references(() => householdMembers.id, { onDelete: 'cascade' }),
    doctorId: uuid('doctor_id').references(() => doctors.id, { onDelete: 'set null' }),

    /** Civil date plus wall-clock time: a 4pm appointment is 4pm locally. */
    scheduledOn: text('scheduled_on').notNull(),
    scheduledAtTime: text('scheduled_at_time'),
    location: text('location'),
    reason: text('reason'),
    status: text('status').$type<(typeof APPOINTMENT_STATUSES)[number]>().notNull().default('scheduled'),

    /** What the doctor said. Recorded, never interpreted. */
    outcomeNotes: text('outcome_notes'),
    followUpOn: text('follow_up_on'),

    remindDaysBefore: integer('remind_days_before').notNull().default(1),
    reminderSentOn: text('reminder_sent_on'),

    seriesId: uuid('series_id').references(() => recurringSeries.id, { onDelete: 'set null' }),
    occurrenceDate: text('occurrence_date'),

    notes: text('notes'),
    ...timestamps,
    ...softDelete,
    ...authorship,
  },
  (t) => [
    index('appointments_schedule_idx')
      .on(t.householdId, t.scheduledOn)
      .where(sql`deleted_at IS NULL`),
    index('appointments_member_idx').on(t.householdId, t.memberId).where(sql`deleted_at IS NULL`),
    // The reminder sweep is global across households.
    index('appointments_upcoming_global_idx')
      .on(t.scheduledOn)
      .where(sql`status = 'scheduled' AND deleted_at IS NULL`),
    uniqueIndex('appointments_series_occurrence_uq')
      .on(t.seriesId, t.occurrenceDate)
      .where(sql`series_id IS NOT NULL`),
    check('appointments_status_chk', inList('status', APPOINTMENT_STATUSES)),
    check(
      'appointments_time_chk',
      sql`${t.scheduledAtTime} IS NULL OR ${t.scheduledAtTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check('appointments_follow_up_chk', sql`${t.followUpOn} IS NULL OR ${t.followUpOn} >= ${t.scheduledOn}`),
  ],
);

export const medicines = pgTable(
  'medicines',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => householdMembers.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),

    /**
     * Verbatim, as written on the prescription — "1 tablet", "5ml", "half a
     * tablet". Never parsed into a number and a unit: a dose the system
     * misreads is a dose the household gets wrong.
     */
    doseText: text('dose_text').notNull(),
    /** Also verbatim — "twice daily, after food". */
    frequencyText: text('frequency_text'),
    /** Anything else on the label, shown unaltered. */
    instructions: text('instructions'),

    /**
     * The explicit times the household wants reminding, entered by them.
     * Deliberately NOT inferred from `frequencyText`.
     */
    reminderTimes: text('reminder_times').array().notNull().default(sql`'{}'::text[]`),

    startDate: text('start_date').notNull(),
    /** Null means ongoing. */
    endDate: text('end_date'),

    /** Counted down as doses are recorded, so a refill can be flagged. */
    quantityRemaining: numeric('quantity_remaining', { precision: 10, scale: 2 }),
    /** Flag a refill at or below this. Null means never flag. */
    refillThreshold: numeric('refill_threshold', { precision: 10, scale: 2 }),
    refillNotifiedOn: text('refill_notified_on'),

    prescribedByDoctorId: uuid('prescribed_by_doctor_id').references(() => doctors.id, {
      onDelete: 'set null',
    }),

    seriesId: uuid('series_id').references(() => recurringSeries.id, { onDelete: 'set null' }),
    notes: text('notes'),
    ...timestamps,
    ...softDelete,
    ...authorship,
  },
  (t) => [
    index('medicines_member_idx').on(t.householdId, t.memberId).where(sql`deleted_at IS NULL`),
    index('medicines_active_idx')
      .on(t.householdId, t.endDate)
      .where(sql`deleted_at IS NULL`),
    check('medicines_period_chk', sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`),
    check(
      'medicines_quantity_chk',
      sql`${t.quantityRemaining} IS NULL OR ${t.quantityRemaining} >= 0`,
    ),
  ],
);

/**
 * One row per scheduled dose.
 *
 * Generated ahead from `medicines.reminderTimes`, so the household sees what
 * is due today and can record what actually happened. "Missed" is recorded
 * honestly rather than hidden — an abandoned course is exactly the thing a
 * household needs to be able to see (docs/00).
 */
export const medicineDoses = pgTable(
  'medicine_doses',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    medicineId: uuid('medicine_id')
      .notNull()
      .references(() => medicines.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => householdMembers.id, { onDelete: 'cascade' }),

    /** Civil date and wall-clock time, plus the instant for the global sweep. */
    scheduledOn: text('scheduled_on').notNull(),
    scheduledAtTime: text('scheduled_at_time').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),

    status: text('status').$type<(typeof DOSE_STATUSES)[number]>().notNull().default('due'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }),
    recordedByMemberId: uuid('recorded_by_member_id').references(() => householdMembers.id, {
      onDelete: 'set null',
    }),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // Duplicates are impossible at the row level, not merely unlikely.
    uniqueIndex('medicine_doses_uq').on(t.medicineId, t.scheduledAt),
    index('medicine_doses_day_idx').on(t.householdId, t.scheduledOn, t.status),
    index('medicine_doses_member_idx').on(t.memberId, t.scheduledOn),
    // Global: the sweep that marks missed doses and sends reminders.
    index('medicine_doses_due_global_idx')
      .on(t.scheduledAt)
      .where(sql`status = 'due'`),
    check('medicine_doses_status_chk', inList('status', DOSE_STATUSES)),
    check(
      'medicine_doses_recorded_chk',
      sql`(${t.status} IN ('taken', 'skipped')) = (${t.recordedAt} IS NOT NULL)`,
    ),
  ],
);

export { APPOINTMENT_STATUSES, DOSE_STATUSES };
