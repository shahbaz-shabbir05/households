/**
 * Money-out ledger, inventory and shopping.
 *
 * `expenses` lands here rather than in phase 4 because the shopping-trip
 * workflow depends on it: a completed trip that does not record what was spent
 * is exactly the disconnected-CRUD failure this product exists to avoid
 * (docs/01 §46). Phase 4 layers bills, budgets and reporting on top of this
 * same ledger.
 *
 * Groceries and household supplies share one `inventory_items` table: the
 * fields are identical and the low-stock rule is the same rule, so two tables
 * would mean two copies of it (docs/01).
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  bigint,
} from 'drizzle-orm/pg-core';
import {
  EXPENSE_CATEGORIES,
  INVENTORY_CATEGORIES,
  INVENTORY_KINDS,
  PAYMENT_METHODS,
  PRIORITIES,
  SHOPPING_LIST_STATUSES,
  UNITS,
  type ExpenseCategory,
  type InventoryCategory,
  type InventoryKind,
  type PaymentMethod,
  type Priority,
  type ShoppingListStatus,
  type Unit,
} from '@hms/shared';
import { households, householdMembers } from './identity.js';
import { authorship, primaryId, softDelete, timestamps } from './_shared.js';

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(', ')})`);

/**
 * The single money-out ledger. Bills (phase 4) are *obligations*; an expense is
 * money that actually left. Paying a bill will write one of these and link it.
 */
export const expenses = pgTable(
  'expenses',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),

    /** Integer minor units. Never a float (docs/04). */
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    /** A civil date: "we spent this on Tuesday" is timezone-independent. */
    spentOn: text('spent_on').notNull(),

    category: text('category').$type<ExpenseCategory>().notNull().default('other'),
    subcategory: text('subcategory'),

    /** Who paid. */
    paidByMemberId: uuid('paid_by_member_id').references(() => householdMembers.id, {
      onDelete: 'set null',
    }),
    /** Who it was for — lets "spend per person" be answered without guessing. */
    forMemberId: uuid('for_member_id').references(() => householdMembers.id, { onDelete: 'set null' }),

    paymentMethod: text('payment_method').$type<PaymentMethod>().notNull().default('cash'),
    merchant: text('merchant'),
    description: text('description'),

    ...timestamps,
    ...softDelete,
    ...authorship,
  },
  (t) => [
    index('expenses_period_idx').on(t.householdId, t.spentOn.desc()).where(sql`deleted_at IS NULL`),
    index('expenses_category_idx').on(t.householdId, t.category, t.spentOn).where(sql`deleted_at IS NULL`),
    index('expenses_payer_idx').on(t.householdId, t.paidByMemberId).where(sql`deleted_at IS NULL`),
    check('expenses_amount_chk', sql`${t.amountMinor} >= 0`),
    check('expenses_currency_chk', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('expenses_category_chk', inList('category', EXPENSE_CATEGORIES)),
    check('expenses_payment_method_chk', inList('payment_method', PAYMENT_METHODS)),
  ],
);

/**
 * What the household has. `kind` separates groceries from durable supplies for
 * presentation only — the low-stock rule and every field are shared.
 */
export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),

    kind: text('kind').$type<InventoryKind>().notNull().default('grocery'),
    name: text('name').notNull(),
    category: text('category').$type<InventoryCategory>().notNull().default('other'),
    unit: text('unit').$type<Unit>().notNull().default('piece'),

    /**
     * Fractional quantities are real (1.5 kg of rice), so this is `numeric`,
     * not an integer. Money never uses `numeric` in this schema — it is always
     * integer minor units — so parsing numeric as a JS number is safe here.
     */
    quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull().default('0'),
    /** Below this, the item is "running low". Null means never warn. */
    minQuantity: numeric('min_quantity', { precision: 12, scale: 3 }),

    location: text('location'),
    expiryDate: text('expiry_date'),
    brand: text('brand'),
    preferredBrand: text('preferred_brand'),
    estimatedPriceMinor: bigint('estimated_price_minor', { mode: 'number' }),

    /** "We buy rice about every 30 days" — drives a restock suggestion. */
    restockIntervalDays: integer('restock_interval_days'),
    lastPurchasedOn: text('last_purchased_on'),

    notes: text('notes'),
    ...timestamps,
    ...softDelete,
    ...authorship,
  },
  (t) => [
    index('inventory_household_idx').on(t.householdId, t.kind, t.category).where(sql`deleted_at IS NULL`),
    // Partial: only items with a threshold can ever be low, so the low-stock
    // scan never touches the rest.
    index('inventory_low_idx')
      .on(t.householdId)
      .where(sql`deleted_at IS NULL AND min_quantity IS NOT NULL`),
    index('inventory_expiry_idx')
      .on(t.householdId, t.expiryDate)
      .where(sql`deleted_at IS NULL AND expiry_date IS NOT NULL`),
    // One entry per named thing per household — stops "Milk" and "milk" drifting apart.
    uniqueIndex('inventory_name_uq')
      .on(t.householdId, sql`lower(${t.name})`)
      .where(sql`deleted_at IS NULL`),
    check('inventory_kind_chk', inList('kind', INVENTORY_KINDS)),
    check('inventory_category_chk', inList('category', INVENTORY_CATEGORIES)),
    check('inventory_unit_chk', inList('unit', UNITS)),
    check('inventory_quantity_chk', sql`${t.quantity} >= 0`),
    check('inventory_min_quantity_chk', sql`${t.minQuantity} IS NULL OR ${t.minQuantity} >= 0`),
  ],
);

export const shoppingLists = pgTable(
  'shopping_lists',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Grouping by store is how a list becomes usable while actually shopping. */
    store: text('store'),
    status: text('status').$type<ShoppingListStatus>().notNull().default('open'),
    shopperMemberId: uuid('shopper_member_id').references(() => householdMembers.id, {
      onDelete: 'set null',
    }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
    ...softDelete,
    ...authorship,
  },
  (t) => [
    index('shopping_lists_status_idx').on(t.householdId, t.status).where(sql`deleted_at IS NULL`),
    check('shopping_lists_status_chk', inList('status', SHOPPING_LIST_STATUSES)),
    check(
      'shopping_lists_completed_chk',
      sql`${t.status} <> 'completed' OR ${t.completedAt} IS NOT NULL`,
    ),
  ],
);

export const shoppingListItems = pgTable(
  'shopping_list_items',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    listId: uuid('list_id').notNull().references(() => shoppingLists.id, { onDelete: 'cascade' }),

    /** Null for an ad-hoc item that is not tracked in inventory. */
    inventoryItemId: uuid('inventory_item_id').references(() => inventoryItems.id, {
      onDelete: 'set null',
    }),
    /**
     * The name as it was when added. Kept so shopping history still reads
     * correctly after an inventory item is renamed or deleted — a small
     * denormalisation that prevents a confusing class of bug.
     */
    nameSnapshot: text('name_snapshot').notNull(),
    category: text('category').$type<InventoryCategory>().notNull().default('other'),

    quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull().default('1'),
    unit: text('unit').$type<Unit>().notNull().default('piece'),
    priority: text('priority').$type<Priority>().notNull().default('normal'),

    isPurchased: boolean('is_purchased').notNull().default(false),
    actualPriceMinor: bigint('actual_price_minor', { mode: 'number' }),
    notes: text('notes'),

    addedByMemberId: uuid('added_by_member_id').references(() => householdMembers.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (t) => [
    index('shopping_list_items_list_idx').on(t.listId, t.category),
    index('shopping_list_items_inventory_idx').on(t.inventoryItemId),
    check('shopping_list_items_quantity_chk', sql`${t.quantity} > 0`),
    check('shopping_list_items_unit_chk', inList('unit', UNITS)),
    check('shopping_list_items_priority_chk', inList('priority', PRIORITIES)),
    check(
      'shopping_list_items_price_chk',
      sql`${t.actualPriceMinor} IS NULL OR ${t.actualPriceMinor} >= 0`,
    ),
  ],
);

/**
 * The record of a completed shopping run: the join between a list, the expense
 * it produced, and the inventory it restocked.
 *
 * The FK points trip → expense (not the reverse) to avoid a circular
 * reference; the unique index makes the reverse lookup cheap and enforces 1:1.
 */
export const shoppingTrips = pgTable(
  'shopping_trips',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    listId: uuid('list_id').notNull().references(() => shoppingLists.id, { onDelete: 'cascade' }),
    /** Null when the shopper chose not to record what was spent. */
    expenseId: uuid('expense_id').references(() => expenses.id, { onDelete: 'set null' }),
    shopperMemberId: uuid('shopper_member_id').references(() => householdMembers.id, {
      onDelete: 'set null',
    }),
    store: text('store'),
    totalMinor: bigint('total_minor', { mode: 'number' }),
    itemsPurchased: integer('items_purchased').notNull().default(0),
    shoppedOn: text('shopped_on').notNull(),
    ...timestamps,
    ...authorship,
  },
  (t) => [
    index('shopping_trips_household_idx').on(t.householdId, t.shoppedOn.desc()),
    uniqueIndex('shopping_trips_expense_uq')
      .on(t.expenseId)
      .where(sql`expense_id IS NOT NULL`),
    uniqueIndex('shopping_trips_list_uq').on(t.listId),
  ],
);
