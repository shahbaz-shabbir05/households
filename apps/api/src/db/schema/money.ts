/**
 * Obligations and limits: providers, bills and budgets.
 *
 * A bill is what the household *owes*; an expense is money that actually left
 * (docs/01). Paying a bill writes an expense and links the two, so "what's due"
 * and "what did we spend" stay separate questions with one consistent answer.
 *
 * Subscriptions are not a separate engine. A subscription is a recurring bill
 * with `bill_type = 'subscription'`; two engines would mean two recurrence
 * integrations and two overdue calculations that drift apart (docs/16 §B.3).
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  BILL_STATUSES,
  BILL_TYPES,
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  UTILITY_KINDS,
  type BillStatus,
  type BillType,
  type ExpenseCategory,
  type PaymentMethod,
  type UtilityKind,
} from '@hms/shared';
import { households, householdMembers } from './identity.js';
import { recurringSeries } from './platform.js';
import { expenses } from './shopping.js';
import { authorship, primaryId, softDelete, timestamps } from './_shared.js';

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(', ')})`);

/**
 * Who the household pays. Created on demand by name the first time a bill
 * names them, so there is reuse without a screen anyone has to maintain.
 */
export const providers = pgTable(
  'providers',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    utilityKind: text('utility_kind').$type<UtilityKind>(),
    accountNumber: text('account_number'),
    phone: text('phone'),
    website: text('website'),
    notes: text('notes'),
    ...timestamps,
    ...softDelete,
    ...authorship,
  },
  (t) => [
    // One provider per name per household, so "K-Electric" and "k-electric"
    // cannot both accumulate half the history.
    uniqueIndex('providers_name_uq')
      .on(t.householdId, sql`lower(${t.name})`)
      .where(sql`deleted_at IS NULL`),
    check(
      'providers_utility_kind_chk',
      sql`${t.utilityKind} IS NULL OR ${sql.raw(`utility_kind IN (${UTILITY_KINDS.map((v) => `'${v}'`).join(', ')})`)}`,
    ),
  ],
);

export const bills = pgTable(
  'bills',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    billType: text('bill_type').$type<BillType>().notNull().default('utility'),
    providerId: uuid('provider_id').references(() => providers.id, { onDelete: 'set null' }),
    accountNumber: text('account_number'),

    /** The period the bill covers, which is not the same as when it is due. */
    periodStart: text('period_start'),
    periodEnd: text('period_end'),
    issueDate: text('issue_date'),
    dueDate: text('due_date').notNull(),

    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),

    paidAmountMinor: bigint('paid_amount_minor', { mode: 'number' }),
    paidOn: text('paid_on'),
    paymentMethod: text('payment_method').$type<PaymentMethod>(),
    /** The ledger entry this payment produced. */
    expenseId: uuid('expense_id').references(() => expenses.id, { onDelete: 'set null' }),

    /**
     * Derived, not authoritative. The truth is `paid_on IS NOT NULL` plus
     * `due_date` against today in household time; this column is a
     * materialised convenience so the status can be indexed, and it is
     * recomputed on write and by a job so it cannot drift (docs/04).
     */
    status: text('status').$type<BillStatus>().notNull().default('upcoming'),

    /** Which expense category a payment lands in. */
    expenseCategory: text('expense_category').$type<ExpenseCategory>().notNull().default('utilities'),
    ownerMemberId: uuid('owner_member_id').references(() => householdMembers.id, { onDelete: 'set null' }),

    /** Days before the due date to raise a reminder. */
    remindDaysBefore: bigint('remind_days_before', { mode: 'number' }).notNull().default(3),
    reminderSentOn: text('reminder_sent_on'),

    seriesId: uuid('series_id').references(() => recurringSeries.id, { onDelete: 'set null' }),
    occurrenceDate: text('occurrence_date'),

    notes: text('notes'),
    ...timestamps,
    ...softDelete,
    ...authorship,
  },
  (t) => [
    index('bills_due_idx').on(t.householdId, t.status, t.dueDate).where(sql`deleted_at IS NULL`),
    index('bills_type_idx').on(t.householdId, t.billType).where(sql`deleted_at IS NULL`),
    index('bills_provider_idx').on(t.householdId, t.providerId).where(sql`deleted_at IS NULL`),
    // The scan that raises due/overdue notices sweeps globally.
    index('bills_unpaid_global_idx')
      .on(t.dueDate)
      .where(sql`paid_on IS NULL AND deleted_at IS NULL`),
    uniqueIndex('bills_series_occurrence_uq')
      .on(t.seriesId, t.occurrenceDate)
      .where(sql`series_id IS NOT NULL`),
    check('bills_type_chk', inList('bill_type', BILL_TYPES)),
    check('bills_status_chk', inList('status', BILL_STATUSES)),
    check('bills_expense_category_chk', inList('expense_category', EXPENSE_CATEGORIES)),
    check(
      'bills_payment_method_chk',
      sql`${t.paymentMethod} IS NULL OR ${sql.raw(`payment_method IN (${PAYMENT_METHODS.map((v) => `'${v}'`).join(', ')})`)}`,
    ),
    check('bills_amount_chk', sql`${t.amountMinor} >= 0`),
    check('bills_currency_chk', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    // A paid bill must say when it was paid, and vice versa.
    check('bills_paid_chk', sql`(${t.status} = 'paid') = (${t.paidOn} IS NOT NULL)`),
    check('bills_period_chk', sql`${t.periodEnd} IS NULL OR ${t.periodStart} IS NULL OR ${t.periodEnd} >= ${t.periodStart}`),
  ],
);

/**
 * A spending limit for a month.
 *
 * One row per category (or one overall, with a null category), applying from
 * `startsOn` until `endsOn`. Budgets are deliberately not per-month rows: a
 * household sets "groceries, 50,000 a month" once, not twelve times a year.
 */
export const budgets = pgTable(
  'budgets',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    /** Null means the whole household's monthly limit. */
    category: text('category').$type<ExpenseCategory>(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    startsOn: text('starts_on').notNull(),
    /** Null means it is still in force. */
    endsOn: text('ends_on'),
    /** Warn at this fraction of the limit, before it is crossed. */
    warnAtPercent: bigint('warn_at_percent', { mode: 'number' }).notNull().default(80),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
    ...softDelete,
    ...authorship,
  },
  (t) => [
    // At most one live budget per category — two would make "am I over?" ambiguous.
    uniqueIndex('budgets_category_uq')
      .on(t.householdId, sql`coalesce(${t.category}, '__overall__')`)
      .where(sql`ends_on IS NULL AND deleted_at IS NULL`),
    index('budgets_household_idx').on(t.householdId).where(sql`deleted_at IS NULL`),
    check(
      'budgets_category_chk',
      sql`${t.category} IS NULL OR ${sql.raw(`category IN (${EXPENSE_CATEGORIES.map((v) => `'${v}'`).join(', ')})`)}`,
    ),
    check('budgets_amount_chk', sql`${t.amountMinor} > 0`),
    check('budgets_warn_chk', sql`${t.warnAtPercent} > 0 AND ${t.warnAtPercent} <= 100`),
    check('budgets_period_chk', sql`${t.endsOn} IS NULL OR ${t.endsOn} >= ${t.startsOn}`),
  ],
);
