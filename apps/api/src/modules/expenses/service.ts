/**
 * The money-out ledger.
 *
 * Other modules never write to `expenses` directly — they call `createWithin`
 * with their own transaction. That is what keeps the monolith modular: the
 * shopping module records a spend without knowing the table exists (docs/05).
 */

import { and, asc, count, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  endOfMonth,
  startOfMonth,
  type CreateExpenseInput,
  type ExpenseCategory,
  type ListExpensesQuery,
  type PaymentMethod,
  type UpdateExpenseInput,
} from '@hms/shared';
import { expenses, householdMembers } from '../../db/schema/index.js';
import type { Database, DbExecutor } from '../../db/client.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { diffFields, writeAudit } from '../../core/audit.js';
import { assertCan } from '../../core/policy/index.js';
import type { RequestContext } from '../../core/request-context.js';
import { todayIn } from '../../core/time.js';
import { offsetOf, paginated } from '../../core/pagination.js';

export interface ExpenseView {
  id: string;
  amountMinor: number;
  currency: string;
  spentOn: string;
  category: ExpenseCategory;
  subcategory: string | null;
  paidByMemberId: string | null;
  paidByName: string | null;
  forMemberId: string | null;
  paymentMethod: PaymentMethod;
  merchant: string | null;
  description: string | null;
  createdAt: string;
}

export interface CategoryTotal {
  category: ExpenseCategory;
  amountMinor: number;
  count: number;
}

export interface MonthlySummary {
  month: string;
  currency: string;
  totalMinor: number;
  previousMonthMinor: number;
  /** Null when the previous month had no spend — a change from zero is not a percentage. */
  changePercent: number | null;
  byCategory: CategoryTotal[];
  largest: ExpenseView[];
  expenseCount: number;
}

export class ExpenseService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Records a spend inside a caller-supplied transaction.
   *
   * The public entry point for other modules. Keeping it transaction-aware is
   * what lets a shopping trip create its expense atomically — a partial
   * success there would corrupt both inventory and spend (docs/06).
   */
  async createWithin(
    tx: DbExecutor,
    ctx: RequestContext,
    input: CreateExpenseInput,
  ): Promise<ExpenseView> {
    assertCan(ctx, 'expense:create');
    await this.assertMembersExist(tx, ctx, [input.paidByMemberId, input.forMemberId]);

    const [row] = await tx
      .insert(expenses)
      .values({
        householdId: ctx.household.id,
        amountMinor: input.amountMinor,
        currency: input.currency ?? ctx.household.currency,
        spentOn: input.spentOn,
        category: input.category,
        subcategory: input.subcategory ?? null,
        // An unattributed expense defaults to whoever recorded it.
        paidByMemberId: input.paidByMemberId ?? ctx.member.id,
        forMemberId: input.forMemberId ?? null,
        paymentMethod: input.paymentMethod,
        merchant: input.merchant ?? null,
        description: input.description ?? null,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      })
      .returning();

    await writeAudit(tx, ctx, {
      entityType: 'expense',
      entityId: row!.id,
      action: 'create',
      summary: `Recorded ${row!.currency} ${(row!.amountMinor / 100).toFixed(2)} on ${row!.category}`,
    });

    return toView(row!, null);
  }

  async create(ctx: RequestContext, input: CreateExpenseInput): Promise<ExpenseView> {
    const created = await this.db.transaction((tx) => this.createWithin(tx, ctx, input));
    return { ...created, paidByName: await this.memberName(created.paidByMemberId) };
  }

  async list(ctx: RequestContext, query: ListExpensesQuery) {
    assertCan(ctx, 'expense:read');

    const where = and(
      eq(expenses.householdId, ctx.household.id),
      isNull(expenses.deletedAt),
      ...this.filters(query),
    );

    const orderColumn = {
      spentOn: expenses.spentOn,
      amountMinor: expenses.amountMinor,
      createdAt: expenses.createdAt,
    }[query.sort];

    const [rows, totals, sum] = await Promise.all([
      this.db
        .select({ expense: expenses, paidByName: householdMembers.displayName })
        .from(expenses)
        .leftJoin(householdMembers, eq(householdMembers.id, expenses.paidByMemberId))
        .where(where)
        .orderBy(query.order === 'asc' ? asc(orderColumn) : desc(orderColumn), desc(expenses.createdAt))
        .limit(query.perPage)
        .offset(offsetOf(query)),
      this.db.select({ value: count() }).from(expenses).where(where),
      this.db
        .select({ value: sql<number>`coalesce(sum(${expenses.amountMinor}), 0)::bigint` })
        .from(expenses)
        .where(where),
    ]);

    return {
      ...paginated(rows.map((r) => toView(r.expense, r.paidByName)), totals[0]?.value ?? 0, query),
      // The total of everything matching the filter, not just this page — the
      // number a user actually wants when they filter by category or month.
      totals: { filteredAmountMinor: Number(sum[0]?.value ?? 0), currency: ctx.household.currency },
    };
  }

  async get(ctx: RequestContext, expenseId: string): Promise<ExpenseView> {
    assertCan(ctx, 'expense:read');
    const row = await this.find(ctx, expenseId);
    return toView(row, await this.memberName(row.paidByMemberId));
  }

  async update(ctx: RequestContext, expenseId: string, input: UpdateExpenseInput): Promise<ExpenseView> {
    assertCan(ctx, 'expense:update');
    const existing = await this.find(ctx, expenseId);

    const updated = await this.db.transaction(async (tx) => {
      await this.assertMembersExist(tx, ctx, [input.paidByMemberId, input.forMemberId]);
      const changes = diffFields(existing as unknown as Record<string, unknown>, input);
      if (!changes) return existing;

      const [row] = await tx
        .update(expenses)
        .set({ ...input, updatedBy: ctx.user.id, updatedAt: this.now() })
        .where(eq(expenses.id, expenseId))
        .returning();

      await writeAudit(tx, ctx, { entityType: 'expense', entityId: expenseId, action: 'update', changes });
      return row!;
    });

    return toView(updated, await this.memberName(updated.paidByMemberId));
  }

  async remove(ctx: RequestContext, expenseId: string): Promise<void> {
    assertCan(ctx, 'expense:delete');
    const existing = await this.find(ctx, expenseId);

    await this.db.transaction(async (tx) => {
      // Soft delete: a hard delete would silently change last month's totals.
      await tx
        .update(expenses)
        .set({ deletedAt: this.now(), updatedBy: ctx.user.id })
        .where(eq(expenses.id, expenseId));
      await writeAudit(tx, ctx, {
        entityType: 'expense',
        entityId: expenseId,
        action: 'delete',
        summary: `Deleted ${existing.currency} ${(existing.amountMinor / 100).toFixed(2)}`,
      });
    });
  }

  /**
   * The "what did we spend this month" answer, with a comparison — a number
   * next to last month's number is worth more than any chart (docs/11).
   */
  async monthlySummary(ctx: RequestContext, month?: string): Promise<MonthlySummary> {
    assertCan(ctx, 'expense:read');

    const today = todayIn(ctx.household.timezone, this.now());
    const period = month ?? today.slice(0, 7);
    const from = `${period}-01`;
    const to = endOfMonth(from);
    const previousFrom = startOfMonth(addMonthsToPeriod(from, -1));
    const previousTo = endOfMonth(previousFrom);

    const scope = (start: string, end: string) =>
      and(
        eq(expenses.householdId, ctx.household.id),
        isNull(expenses.deletedAt),
        gte(expenses.spentOn, start),
        lte(expenses.spentOn, end),
      );

    const [current, previous, byCategory, largest] = await Promise.all([
      this.db
        .select({
          total: sql<number>`coalesce(sum(${expenses.amountMinor}), 0)::bigint`,
          items: count(),
        })
        .from(expenses)
        .where(scope(from, to)),
      this.db
        .select({ total: sql<number>`coalesce(sum(${expenses.amountMinor}), 0)::bigint` })
        .from(expenses)
        .where(scope(previousFrom, previousTo)),
      this.db
        .select({
          category: expenses.category,
          amountMinor: sql<number>`sum(${expenses.amountMinor})::bigint`,
          count: count(),
        })
        .from(expenses)
        .where(scope(from, to))
        .groupBy(expenses.category)
        .orderBy(desc(sql`sum(${expenses.amountMinor})`)),
      this.db
        .select({ expense: expenses, paidByName: householdMembers.displayName })
        .from(expenses)
        .leftJoin(householdMembers, eq(householdMembers.id, expenses.paidByMemberId))
        .where(scope(from, to))
        .orderBy(desc(expenses.amountMinor))
        .limit(5),
    ]);

    const totalMinor = Number(current[0]?.total ?? 0);
    const previousMonthMinor = Number(previous[0]?.total ?? 0);

    return {
      month: period,
      currency: ctx.household.currency,
      totalMinor,
      previousMonthMinor,
      // Null rather than a made-up percentage when there is nothing to compare to.
      changePercent:
        previousMonthMinor === 0
          ? null
          : ((totalMinor - previousMonthMinor) / previousMonthMinor) * 100,
      byCategory: byCategory.map((r) => ({
        category: r.category,
        amountMinor: Number(r.amountMinor),
        count: r.count,
      })),
      largest: largest.map((r) => toView(r.expense, r.paidByName)),
      expenseCount: current[0]?.items ?? 0,
    };
  }

  private filters(query: ListExpensesQuery): SQL[] {
    const filters: SQL[] = [];
    if (query.from) filters.push(gte(expenses.spentOn, query.from));
    if (query.to) filters.push(lte(expenses.spentOn, query.to));
    if (query.category) filters.push(eq(expenses.category, query.category));
    if (query.paidByMemberId) filters.push(eq(expenses.paidByMemberId, query.paidByMemberId));
    if (query.forMemberId) filters.push(eq(expenses.forMemberId, query.forMemberId));
    if (query.paymentMethod) filters.push(eq(expenses.paymentMethod, query.paymentMethod));
    if (query.search) {
      const term = `%${query.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      filters.push(or(ilike(expenses.merchant, term), ilike(expenses.description, term))!);
    }
    return filters;
  }

  private async find(ctx: RequestContext, expenseId: string) {
    const row = await this.db.query.expenses.findFirst({
      where: and(
        eq(expenses.id, expenseId),
        eq(expenses.householdId, ctx.household.id),
        isNull(expenses.deletedAt),
      ),
    });
    if (!row) throw new NotFoundError('Expense');
    return row;
  }

  private async memberName(memberId: string | null): Promise<string | null> {
    if (!memberId) return null;
    const row = await this.db.query.householdMembers.findFirst({
      where: eq(householdMembers.id, memberId),
      columns: { displayName: true },
    });
    return row?.displayName ?? null;
  }

  private async assertMembersExist(
    tx: DbExecutor,
    ctx: RequestContext,
    memberIds: Array<string | null | undefined>,
  ): Promise<void> {
    for (const memberId of memberIds) {
      if (!memberId) continue;
      const row = await tx.query.householdMembers.findFirst({
        where: and(
          eq(householdMembers.id, memberId),
          eq(householdMembers.householdId, ctx.household.id),
          isNull(householdMembers.deletedAt),
        ),
        columns: { id: true },
      });
      if (!row) {
        throw new ValidationError('That person is not a member of this household', [
          { path: 'paidByMemberId', message: 'Unknown member' },
        ]);
      }
    }
  }
}

/** Shifts a `YYYY-MM-DD` by whole months without leaving civil-date space. */
function addMonthsToPeriod(date: string, months: number): string {
  const [y, m] = date.split('-').map(Number);
  const total = y! * 12 + (m! - 1) + months;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

function toView(row: typeof expenses.$inferSelect, paidByName: string | null): ExpenseView {
  return {
    id: row.id,
    amountMinor: Number(row.amountMinor),
    currency: row.currency,
    spentOn: row.spentOn,
    category: row.category,
    subcategory: row.subcategory,
    paidByMemberId: row.paidByMemberId,
    paidByName,
    forMemberId: row.forMemberId,
    paymentMethod: row.paymentMethod,
    merchant: row.merchant,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  };
}
