/**
 * Bills — what the household owes, and when.
 *
 * `pay` is the composition that matters here, and it is the same shape as
 * completing a shopping trip: one transaction that records the payment, writes
 * the expense, links the two and closes any reminder that was nagging about it
 * (§46). A bill marked paid with no ledger entry, or a ledger entry with no
 * bill, is the disconnected-CRUD failure this design exists to avoid.
 *
 * Subscriptions are bills with `billType = 'subscription'`, not a second
 * engine (docs/16 §B.3).
 */

import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  addDays,
  formatMoney,
  type BillStatus,
  type BillType,
  type CivilDate,
  type CreateBillInput,
  type ExpenseCategory,
  type ListBillsQuery,
  type PayBillInput,
  type PaymentMethod,
  type UpdateBillInput,
} from '@hms/shared';
import { bills, expenses, householdMembers, households, providers } from '../../db/schema/index.js';
import type { Database, DbExecutor } from '../../db/client.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { diffFields, writeAudit } from '../../core/audit.js';
import { assertCan } from '../../core/policy/index.js';
import type { RequestContext } from '../../core/request-context.js';
import { todayIn } from '../../core/time.js';
import { offsetOf, paginated } from '../../core/pagination.js';
import { createSeries } from '../../core/series.js';
import type { Materialiser } from '../../core/recurrence-service.js';
import type { ExpenseService, ExpenseView } from '../expenses/service.js';
import type { ReminderService } from '../reminders/service.js';
import type { NotificationService } from '../../core/notifications/index.js';

export interface BillView {
  id: string;
  name: string;
  billType: BillType;
  providerId: string | null;
  providerName: string | null;
  accountNumber: string | null;
  dueDate: CivilDate;
  issueDate: CivilDate | null;
  periodStart: CivilDate | null;
  periodEnd: CivilDate | null;
  amountMinor: number;
  currency: string;
  paidAmountMinor: number | null;
  paidOn: CivilDate | null;
  paymentMethod: PaymentMethod | null;
  expenseId: string | null;
  status: BillStatus;
  expenseCategory: ExpenseCategory;
  ownerMemberId: string | null;
  remindDaysBefore: number;
  isRecurring: boolean;
  /** How many days late, when it is. */
  daysOverdue: number;
  notes: string | null;
  createdAt: string;
}

export interface PaymentResult {
  bill: BillView;
  expense: ExpenseView | null;
  remindersResolved: number;
}

interface BillTemplate {
  name: string;
  billType: BillType;
  providerId?: string | null;
  accountNumber?: string | null;
  amountMinor: number;
  currency: string;
  expenseCategory: ExpenseCategory;
  ownerMemberId?: string | null;
  remindDaysBefore: number;
  notes?: string | null;
  createdBy?: string | null;
}

/**
 * The single definition of a bill's state.
 *
 * `bills.status` is a materialised copy of this, kept only so it can be
 * indexed; everything that needs the truth calls this (docs/04).
 */
export function deriveStatus(
  bill: { paidOn: string | null; dueDate: string; status: BillStatus; remindDaysBefore: number },
  today: CivilDate,
): BillStatus {
  if (bill.status === 'cancelled') return 'cancelled';
  if (bill.paidOn !== null) return 'paid';
  if (bill.dueDate < today) return 'overdue';
  // "Due" means "needs attention now", which is the reminder window — not just
  // the single day it happens to fall on.
  if (bill.dueDate <= addDays(today, Number(bill.remindDaysBefore))) return 'due';
  return 'upcoming';
}

export class BillService {
  constructor(
    private readonly db: Database,
    private readonly expenses: ExpenseService,
    private readonly reminders: ReminderService,
    private readonly notifications: NotificationService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  readonly materialiser: Materialiser = async ({ db, householdId, seriesId, occurrenceDate, template }) => {
    const t = template as unknown as BillTemplate;
    const [row] = await db
      .insert(bills)
      .values({
        householdId,
        name: t.name,
        billType: t.billType,
        providerId: t.providerId ?? null,
        accountNumber: t.accountNumber ?? null,
        dueDate: occurrenceDate,
        amountMinor: t.amountMinor,
        currency: t.currency,
        expenseCategory: t.expenseCategory,
        ownerMemberId: t.ownerMemberId ?? null,
        remindDaysBefore: t.remindDaysBefore,
        notes: t.notes ?? null,
        seriesId,
        occurrenceDate,
        createdBy: t.createdBy ?? null,
      })
      .returning({ id: bills.id });
    return row!.id;
  };

  async list(ctx: RequestContext, query: ListBillsQuery) {
    assertCan(ctx, 'bill:read');
    const today = todayIn(ctx.household.timezone, this.now());

    const where = and(
      eq(bills.householdId, ctx.household.id),
      isNull(bills.deletedAt),
      ...this.filters(query),
    );

    const orderColumn = { dueDate: bills.dueDate, amountMinor: bills.amountMinor, name: bills.name }[
      query.sort
    ];

    const [rows, totals, outstanding] = await Promise.all([
      this.db
        .select({ bill: bills, providerName: providers.name })
        .from(bills)
        .leftJoin(providers, eq(providers.id, bills.providerId))
        .where(where)
        .orderBy(query.order === 'asc' ? asc(orderColumn) : desc(orderColumn), asc(bills.name))
        .limit(query.perPage)
        .offset(offsetOf(query)),
      this.db.select({ value: count() }).from(bills).where(where),
      this.db
        .select({ value: sql<number>`coalesce(sum(${bills.amountMinor}), 0)::bigint` })
        .from(bills)
        .where(
          and(
            eq(bills.householdId, ctx.household.id),
            isNull(bills.deletedAt),
            isNull(bills.paidOn),
            ne(bills.status, 'cancelled'),
          ),
        ),
    ]);

    return {
      ...paginated(rows.map((r) => toView(r.bill, r.providerName, today)), totals[0]?.value ?? 0, query),
      totals: {
        // Everything still owed, not just this page — the number people open
        // this screen to find.
        outstandingAmountMinor: Number(outstanding[0]?.value ?? 0),
        currency: ctx.household.currency,
      },
    };
  }

  async get(ctx: RequestContext, billId: string): Promise<BillView> {
    assertCan(ctx, 'bill:read');
    const bill = await this.find(ctx, billId);
    return toView(bill, await this.providerName(bill.providerId), todayIn(ctx.household.timezone, this.now()));
  }

  async create(ctx: RequestContext, input: CreateBillInput): Promise<BillView> {
    assertCan(ctx, 'bill:create');
    const today = todayIn(ctx.household.timezone, this.now());
    const currency = input.currency ?? ctx.household.currency;

    const created = await this.db.transaction(async (tx) => {
      const providerId = await this.resolveProvider(tx, ctx, input.providerName, input.utilityKind);

      if (input.recurrence) {
        const template: BillTemplate = {
          name: input.name,
          billType: input.billType,
          providerId,
          accountNumber: input.accountNumber ?? null,
          amountMinor: input.amountMinor,
          currency,
          expenseCategory: input.expenseCategory,
          ownerMemberId: input.ownerMemberId ?? null,
          remindDaysBefore: input.remindDaysBefore,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
        };

        const { seriesId } = await createSeries(
          tx,
          {
            householdId: ctx.household.id,
            entityType: 'bill',
            rule: input.recurrence,
            template: template as unknown as Record<string, unknown>,
            anchorDate: input.dueDate,
            timezone: ctx.household.timezone,
          },
          this.materialiser,
          this.now(),
        );

        const first = await tx.query.bills.findFirst({
          where: eq(bills.seriesId, seriesId),
          orderBy: asc(bills.occurrenceDate),
        });
        if (!first) throw new ValidationError('That repeat rule produces no dates');

        await writeAudit(tx, ctx, {
          entityType: 'bill',
          entityId: first.id,
          action: 'create',
          summary: `Created repeating bill "${input.name}"`,
        });
        return first;
      }

      const [row] = await tx
        .insert(bills)
        .values({
          householdId: ctx.household.id,
          name: input.name,
          billType: input.billType,
          providerId,
          accountNumber: input.accountNumber ?? null,
          dueDate: input.dueDate,
          issueDate: input.issueDate ?? null,
          periodStart: input.periodStart ?? null,
          periodEnd: input.periodEnd ?? null,
          amountMinor: input.amountMinor,
          currency,
          expenseCategory: input.expenseCategory,
          ownerMemberId: input.ownerMemberId ?? null,
          remindDaysBefore: input.remindDaysBefore,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();

      await writeAudit(tx, ctx, {
        entityType: 'bill',
        entityId: row!.id,
        action: 'create',
        summary: `Added bill "${row!.name}" for ${formatMoney(Number(row!.amountMinor), row!.currency)}`,
      });
      return row!;
    });

    // The stored status is a cache; set it from the truth straight away.
    const withStatus = await this.syncStatus(created.id, today);
    return toView(withStatus, await this.providerName(withStatus.providerId), today);
  }

  async update(ctx: RequestContext, billId: string, input: UpdateBillInput): Promise<BillView> {
    assertCan(ctx, 'bill:update');
    const existing = await this.find(ctx, billId);
    const today = todayIn(ctx.household.timezone, this.now());

    const updated = await this.db.transaction(async (tx) => {
      const { providerName, ...fields } = input;
      const providerId = providerName
        ? await this.resolveProvider(tx, ctx, providerName)
        : undefined;

      const changes = diffFields(existing as unknown as Record<string, unknown>, fields);
      if (!changes && providerId === undefined) return existing;

      const [row] = await tx
        .update(bills)
        .set({
          ...fields,
          ...(providerId !== undefined ? { providerId } : {}),
          updatedBy: ctx.user.id,
          updatedAt: this.now(),
        })
        .where(eq(bills.id, billId))
        .returning();

      await writeAudit(tx, ctx, { entityType: 'bill', entityId: billId, action: 'update', changes });
      return row!;
    });

    const synced = await this.syncStatus(updated.id, today);
    return toView(synced, await this.providerName(synced.providerId), today);
  }

  /**
   * Records a payment: the bill, the ledger entry and the reminder all move
   * together, or none of them do.
   */
  async pay(ctx: RequestContext, billId: string, input: PayBillInput): Promise<PaymentResult> {
    assertCan(ctx, 'bill:pay');
    if (input.recordExpense) assertCan(ctx, 'expense:create');

    const today = todayIn(ctx.household.timezone, this.now());
    const paidOn = input.paidOn ?? today;

    const result = await this.db.transaction(async (tx) => {
      const bill = await tx.query.bills.findFirst({
        where: and(
          eq(bills.id, billId),
          eq(bills.householdId, ctx.household.id),
          isNull(bills.deletedAt),
        ),
      });
      if (!bill) throw new NotFoundError('Bill');
      // Paying twice would double-count the spend.
      if (bill.paidOn !== null) throw new ConflictError('That bill is already marked paid');
      if (bill.status === 'cancelled') throw new ConflictError('That bill was cancelled');

      const amountMinor = input.amountMinor ?? Number(bill.amountMinor);

      let expense: ExpenseView | null = null;
      if (input.recordExpense) {
        expense = await this.expenses.createWithin(tx, ctx, {
          amountMinor,
          currency: bill.currency,
          spentOn: paidOn,
          category: bill.expenseCategory,
          paymentMethod: input.paymentMethod,
          paidByMemberId: input.paidByMemberId ?? bill.ownerMemberId ?? ctx.member.id,
          merchant: (await this.providerName(bill.providerId)) ?? undefined,
          description: `Bill: ${bill.name}`,
        });

        // Link both ways so either side answers "what was this?" in one join.
        await tx.update(expenses).set({ billId }).where(eq(expenses.id, expense.id));
      }

      const [paid] = await tx
        .update(bills)
        .set({
          paidOn,
          paidAmountMinor: amountMinor,
          paymentMethod: input.paymentMethod,
          expenseId: expense?.id ?? null,
          status: 'paid',
          ...(input.notes ? { notes: input.notes } : {}),
          updatedBy: ctx.user.id,
          updatedAt: this.now(),
        })
        .where(eq(bills.id, billId))
        .returning();

      // Nothing should still be nagging about a bill that is settled.
      const remindersResolved = await this.reminders.resolveForEntity(
        tx,
        ctx.household.id,
        'bill',
        billId,
      );

      await writeAudit(tx, ctx, {
        entityType: 'bill',
        entityId: billId,
        action: 'update',
        summary:
          `Paid "${bill.name}" ${formatMoney(amountMinor, bill.currency)}` +
          (expense ? ' and recorded the expense' : ''),
        changes: { status: { from: bill.status, to: 'paid' }, paidOn: { from: null, to: paidOn } },
      });

      return { bill: paid!, expense, remindersResolved };
    });

    return {
      bill: toView(result.bill, await this.providerName(result.bill.providerId), today),
      expense: result.expense,
      remindersResolved: result.remindersResolved,
    };
  }

  /** Undoes a payment — the common case being a mistyped amount. */
  async unpay(ctx: RequestContext, billId: string): Promise<BillView> {
    assertCan(ctx, 'bill:update');
    const existing = await this.find(ctx, billId);
    if (existing.paidOn === null) throw new ConflictError('That bill is not marked paid');

    const today = todayIn(ctx.household.timezone, this.now());

    await this.db.transaction(async (tx) => {
      // The expense is soft-deleted rather than left orphaned, or the month's
      // total would keep counting a payment that has been undone.
      if (existing.expenseId) {
        await tx
          .update(expenses)
          .set({ deletedAt: this.now(), updatedBy: ctx.user.id })
          .where(eq(expenses.id, existing.expenseId));
      }

      await tx
        .update(bills)
        .set({
          paidOn: null,
          paidAmountMinor: null,
          paymentMethod: null,
          expenseId: null,
          status: deriveStatus({ ...existing, paidOn: null, status: 'upcoming' }, today),
          updatedBy: ctx.user.id,
          updatedAt: this.now(),
        })
        .where(eq(bills.id, billId));

      await writeAudit(tx, ctx, {
        entityType: 'bill',
        entityId: billId,
        action: 'update',
        summary: `Reopened "${existing.name}" and removed its expense`,
      });
    });

    const reread = await this.find(ctx, billId);
    return toView(reread, await this.providerName(reread.providerId), today);
  }

  async remove(ctx: RequestContext, billId: string): Promise<void> {
    assertCan(ctx, 'bill:delete');
    const existing = await this.find(ctx, billId);

    await this.db.transaction(async (tx) => {
      await tx
        .update(bills)
        .set({ deletedAt: this.now(), updatedBy: ctx.user.id })
        .where(eq(bills.id, billId));
      await this.reminders.resolveForEntity(tx, ctx.household.id, 'bill', billId);
      await writeAudit(tx, ctx, {
        entityType: 'bill',
        entityId: billId,
        action: 'delete',
        summary: `Deleted bill "${existing.name}"`,
      });
    });
  }

  /* --------------------------------------------------------------- jobs --- */

  /**
   * Recomputes the cached status for every unpaid bill, and raises a notice
   * for anything now due or overdue.
   *
   * Global across households by design — one of the few queries that is, and
   * named so it is obvious (docs/05). Idempotent: the status write is a pure
   * recompute and the notice carries a dedupe key, so a re-run changes nothing.
   */
  async refreshAndNotify(db: DbExecutor, now: Date = this.now()): Promise<number> {
    const rows = await db
      .select({
        bill: bills,
        timezone: households.timezone,
        quietHoursStart: households.quietHoursStart,
        quietHoursEnd: households.quietHoursEnd,
      })
      .from(bills)
      .innerJoin(households, eq(households.id, bills.householdId))
      .where(and(isNull(bills.paidOn), isNull(bills.deletedAt), ne(bills.status, 'cancelled')))
      .limit(2000);

    let touched = 0;

    for (const row of rows) {
      const today = todayIn(row.timezone, now);
      const next = deriveStatus(row.bill, today);

      if (next !== row.bill.status) {
        await db.update(bills).set({ status: next }).where(eq(bills.id, row.bill.id));
        touched += 1;
      }

      if (next !== 'due' && next !== 'overdue') continue;
      // One notice per bill per day, so an overdue bill nags once rather than
      // ninety-six times.
      if (row.bill.reminderSentOn === today) continue;

      const recipients = await this.recipientsFor(db, row.bill.householdId, row.bill.ownerMemberId);
      if (recipients.length === 0) continue;

      const amount = formatMoney(Number(row.bill.amountMinor), row.bill.currency);
      await this.notifications.publish(
        db,
        {
          timezone: row.timezone,
          quietHoursStart: row.quietHoursStart,
          quietHoursEnd: row.quietHoursEnd,
        },
        {
          householdId: row.bill.householdId,
          memberIds: recipients,
          type: next === 'overdue' ? 'bill.overdue' : 'bill.due_soon',
          title:
            next === 'overdue'
              ? `${row.bill.name} is overdue`
              : `${row.bill.name} is due ${row.bill.dueDate === today ? 'today' : 'soon'}`,
          body: `${amount} · due ${row.bill.dueDate}`,
          priority: next === 'overdue' ? 'high' : 'normal',
          entityType: 'bill',
          entityId: row.bill.id,
          // Keyed by state as well as id, so an overdue notice still lands
          // even after a "due soon" one has been seen.
          dedupeKey: `bill:${row.bill.id}:${next}`,
        },
      );

      await db.update(bills).set({ reminderSentOn: today }).where(eq(bills.id, row.bill.id));
      touched += 1;
    }

    return touched;
  }

  /* ------------------------------------------------------------ helpers --- */

  private async recipientsFor(
    db: DbExecutor,
    householdId: string,
    ownerMemberId: string | null,
  ): Promise<string[]> {
    if (ownerMemberId) return [ownerMemberId];
    // Nobody owns it, so tell the people who can actually pay it.
    const rows = await db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, householdId),
          inArray(householdMembers.role, ['admin', 'adult']),
          eq(householdMembers.isActive, true),
          isNull(householdMembers.deletedAt),
        ),
      );
    return rows.map((r) => r.id);
  }

  /** Finds a provider by name, or creates it the first time it is used. */
  private async resolveProvider(
    tx: DbExecutor,
    ctx: RequestContext,
    name: string | undefined,
    utilityKind?: string,
  ): Promise<string | null> {
    if (!name) return null;

    const existing = await tx
      .select({ id: providers.id })
      .from(providers)
      .where(
        and(
          eq(providers.householdId, ctx.household.id),
          sql`lower(${providers.name}) = ${name.toLowerCase()}`,
          isNull(providers.deletedAt),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0].id;

    const [created] = await tx
      .insert(providers)
      .values({
        householdId: ctx.household.id,
        name,
        utilityKind: (utilityKind ?? null) as never,
        createdBy: ctx.user.id,
      })
      .returning({ id: providers.id });
    return created!.id;
  }

  private async syncStatus(billId: string, today: CivilDate) {
    const bill = await this.db.query.bills.findFirst({ where: eq(bills.id, billId) });
    if (!bill) throw new NotFoundError('Bill');

    const next = deriveStatus(bill, today);
    if (next === bill.status) return bill;

    const [updated] = await this.db
      .update(bills)
      .set({ status: next })
      .where(eq(bills.id, billId))
      .returning();
    return updated!;
  }

  private filters(query: ListBillsQuery): SQL[] {
    const filters: SQL[] = [];
    if (query.status) filters.push(eq(bills.status, query.status));
    if (query.billType) filters.push(eq(bills.billType, query.billType));
    if (query.unpaid) filters.push(and(isNull(bills.paidOn), ne(bills.status, 'cancelled'))!);
    if (query.from) filters.push(gte(bills.dueDate, query.from));
    if (query.to) filters.push(lte(bills.dueDate, query.to));
    if (query.ownerMemberId) filters.push(eq(bills.ownerMemberId, query.ownerMemberId));
    if (query.search) {
      const term = `%${query.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      filters.push(or(ilike(bills.name, term), ilike(bills.accountNumber, term))!);
    }
    return filters;
  }

  private async find(ctx: RequestContext, billId: string) {
    const row = await this.db.query.bills.findFirst({
      where: and(eq(bills.id, billId), eq(bills.householdId, ctx.household.id), isNull(bills.deletedAt)),
    });
    if (!row) throw new NotFoundError('Bill');
    return row;
  }

  private async providerName(providerId: string | null): Promise<string | null> {
    if (!providerId) return null;
    const row = await this.db.query.providers.findFirst({
      where: eq(providers.id, providerId),
      columns: { name: true },
    });
    return row?.name ?? null;
  }
}

function toView(
  row: typeof bills.$inferSelect,
  providerName: string | null,
  today: CivilDate,
): BillView {
  const status = deriveStatus(row, today);
  const daysOverdue =
    status === 'overdue'
      ? Math.round(
          (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${row.dueDate}T00:00:00Z`)) / 86_400_000,
        )
      : 0;

  return {
    id: row.id,
    name: row.name,
    billType: row.billType,
    providerId: row.providerId,
    providerName,
    accountNumber: row.accountNumber,
    dueDate: row.dueDate,
    issueDate: row.issueDate,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    amountMinor: Number(row.amountMinor),
    currency: row.currency,
    paidAmountMinor: row.paidAmountMinor === null ? null : Number(row.paidAmountMinor),
    paidOn: row.paidOn,
    paymentMethod: row.paymentMethod,
    expenseId: row.expenseId,
    status,
    expenseCategory: row.expenseCategory,
    ownerMemberId: row.ownerMemberId,
    remindDaysBefore: Number(row.remindDaysBefore),
    isRecurring: row.seriesId !== null,
    daysOverdue,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}
