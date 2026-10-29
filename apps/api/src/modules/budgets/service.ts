/**
 * Monthly spending limits.
 *
 * A budget is set once and applies every month until it is ended — a household
 * says "groceries, 50,000 a month", not twelve separate numbers a year.
 *
 * Deliberately not a chart: a budget is a single ratio against a limit, which
 * is a meter and a number, not a plot (docs/11).
 */

import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import {
  endOfMonth,
  type BudgetState,
  type CivilDate,
  type CreateBudgetInput,
  type ExpenseCategory,
  type UpdateBudgetInput,
} from '@hms/shared';
import { budgets, expenses } from '../../db/schema/index.js';
import type { Database } from '../../db/client.js';
import {
  ConflictError,
  NotFoundError,
  PG_UNIQUE_VIOLATION,
  ValidationError,
  pgErrorCode,
} from '../../core/errors.js';
import { diffFields, writeAudit } from '../../core/audit.js';
import { assertCan } from '../../core/policy/index.js';
import type { RequestContext } from '../../core/request-context.js';
import { todayIn } from '../../core/time.js';

export interface BudgetView {
  id: string;
  /** Null means the household's overall monthly limit. */
  category: ExpenseCategory | null;
  amountMinor: number;
  currency: string;
  startsOn: CivilDate;
  endsOn: CivilDate | null;
  warnAtPercent: number;
  createdAt: string;
}

export interface BudgetStatus extends BudgetView {
  month: string;
  spentMinor: number;
  remainingMinor: number;
  /** Null when the limit is zero, which the constraints forbid — defensive. */
  usedPercent: number | null;
  state: BudgetState;
}

export class BudgetService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(ctx: RequestContext): Promise<BudgetView[]> {
    assertCan(ctx, 'budget:read');
    const rows = await this.db
      .select()
      .from(budgets)
      .where(and(eq(budgets.householdId, ctx.household.id), isNull(budgets.deletedAt)));
    return rows.map(toView);
  }

  async create(ctx: RequestContext, input: CreateBudgetInput): Promise<BudgetView> {
    assertCan(ctx, 'budget:manage');
    const today = todayIn(ctx.household.timezone, this.now());

    try {
      const created = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(budgets)
          .values({
            householdId: ctx.household.id,
            category: input.category ?? null,
            amountMinor: input.amountMinor,
            currency: input.currency ?? ctx.household.currency,
            startsOn: input.startsOn ?? `${today.slice(0, 7)}-01`,
            warnAtPercent: input.warnAtPercent,
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id,
          })
          .returning();

        await writeAudit(tx, ctx, {
          entityType: 'household',
          entityId: row!.id,
          action: 'create',
          summary: `Set a monthly budget for ${row!.category ?? 'the whole household'}`,
        });
        return row!;
      });
      return toView(created);
    } catch (error) {
      // Two live budgets for one category would make "am I over?" ambiguous.
      if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
        throw new ConflictError(
          input.category
            ? `There is already a budget for ${input.category}`
            : 'There is already an overall household budget',
        );
      }
      throw error;
    }
  }

  async update(ctx: RequestContext, budgetId: string, input: UpdateBudgetInput): Promise<BudgetView> {
    assertCan(ctx, 'budget:manage');
    const existing = await this.find(ctx, budgetId);

    // The database enforces this too, but a CHECK violation surfaces as a bare
    // "that value is not allowed" with no field attached.
    if (input.endsOn && input.endsOn < existing.startsOn) {
      throw new ValidationError('A budget cannot end before it started', [
        { path: 'endsOn', message: `This budget started on ${existing.startsOn}` },
      ]);
    }

    const updated = await this.db.transaction(async (tx) => {
      const changes = diffFields(existing as unknown as Record<string, unknown>, input);
      if (!changes) return existing;

      const [row] = await tx
        .update(budgets)
        .set({ ...input, updatedBy: ctx.user.id, updatedAt: this.now() })
        .where(eq(budgets.id, budgetId))
        .returning();

      await writeAudit(tx, ctx, {
        entityType: 'household',
        entityId: budgetId,
        action: 'update',
        changes,
      });
      return row!;
    });

    return toView(updated);
  }

  async remove(ctx: RequestContext, budgetId: string): Promise<void> {
    assertCan(ctx, 'budget:manage');
    const existing = await this.find(ctx, budgetId);

    await this.db.transaction(async (tx) => {
      await tx
        .update(budgets)
        .set({ deletedAt: this.now(), updatedBy: ctx.user.id })
        .where(eq(budgets.id, budgetId));
      await writeAudit(tx, ctx, {
        entityType: 'household',
        entityId: budgetId,
        action: 'delete',
        summary: `Removed the budget for ${existing.category ?? 'the whole household'}`,
      });
    });
  }

  /**
   * How every live budget is doing this month.
   *
   * The overall budget counts *all* spending; a category budget counts only
   * its own. They are deliberately not made to sum — a household can have an
   * overall limit and a groceries limit, and both are real.
   */
  async status(ctx: RequestContext, month?: string): Promise<BudgetStatus[]> {
    assertCan(ctx, 'budget:read');

    const today = todayIn(ctx.household.timezone, this.now());
    const period = month ?? today.slice(0, 7);
    const from = `${period}-01`;
    const to = endOfMonth(from);

    const live = await this.db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.householdId, ctx.household.id),
          isNull(budgets.deletedAt),
          eq(budgets.isActive, true),
          lte(budgets.startsOn, to),
          or(isNull(budgets.endsOn), gte(budgets.endsOn, from)),
        ),
      );
    if (live.length === 0) return [];

    const spend = await this.db
      .select({
        category: expenses.category,
        total: sql<number>`sum(${expenses.amountMinor})::bigint`,
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.householdId, ctx.household.id),
          isNull(expenses.deletedAt),
          gte(expenses.spentOn, from),
          lte(expenses.spentOn, to),
        ),
      )
      .groupBy(expenses.category);

    const byCategory = new Map(spend.map((r) => [r.category, Number(r.total)]));
    const overall = [...byCategory.values()].reduce((sum, value) => sum + value, 0);

    return live.map((budget) => {
      const limit = Number(budget.amountMinor);
      const spent = budget.category === null ? overall : (byCategory.get(budget.category) ?? 0);
      const usedPercent = limit === 0 ? null : (spent / limit) * 100;

      const state: BudgetState =
        usedPercent === null
          ? 'under'
          : usedPercent >= 100
            ? 'over'
            : usedPercent >= Number(budget.warnAtPercent)
              ? 'approaching'
              : 'under';

      return {
        ...toView(budget),
        month: period,
        spentMinor: spent,
        // Negative once it is blown, which is the honest number to show.
        remainingMinor: limit - spent,
        usedPercent,
        state,
      };
    });
  }

  private async find(ctx: RequestContext, budgetId: string) {
    const row = await this.db.query.budgets.findFirst({
      where: and(
        eq(budgets.id, budgetId),
        eq(budgets.householdId, ctx.household.id),
        isNull(budgets.deletedAt),
      ),
    });
    if (!row) throw new NotFoundError('Budget');
    return row;
  }
}

function toView(row: typeof budgets.$inferSelect): BudgetView {
  return {
    id: row.id,
    category: row.category,
    amountMinor: Number(row.amountMinor),
    currency: row.currency,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    warnAtPercent: Number(row.warnAtPercent),
    createdAt: row.createdAt.toISOString(),
  };
}
