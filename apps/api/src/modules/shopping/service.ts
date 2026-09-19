/**
 * Shopping lists, and the trip workflow.
 *
 * `completeTrip` is the composition this product is built around (§46): in one
 * transaction it marks what was bought, restocks inventory, records the spend
 * and closes the list. Doing it client-side as three calls would guarantee
 * inconsistent data the first time a phone loses signal mid-checkout.
 *
 * Note what this module does *not* do: it never touches `expenses` or
 * `inventory_items` itself. It calls those modules' services with its own
 * transaction, which is what keeps the boundaries real (docs/05).
 */

import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  type AddLowStockInput,
  type AddShoppingItemInput,
  type CompleteTripInput,
  type CreateShoppingListInput,
  type InventoryCategory,
  type ListShoppingListsQuery,
  type Priority,
  type ShoppingListStatus,
  type Unit,
  type UpdateShoppingItemInput,
  type UpdateShoppingListInput,
} from '@hms/shared';
import {
  inventoryItems,
  shoppingListItems,
  shoppingLists,
  shoppingTrips,
} from '../../db/schema/index.js';
import type { Database } from '../../db/client.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { diffFields, writeAudit } from '../../core/audit.js';
import { assertCan } from '../../core/policy/index.js';
import type { RequestContext } from '../../core/request-context.js';
import { todayIn } from '../../core/time.js';
import { offsetOf, paginated } from '../../core/pagination.js';
import type { ExpenseService, ExpenseView } from '../expenses/service.js';
import type { InventoryService } from '../inventory/service.js';

export interface ShoppingItemView {
  id: string;
  inventoryItemId: string | null;
  name: string;
  category: InventoryCategory;
  quantity: number;
  unit: Unit;
  priority: Priority;
  isPurchased: boolean;
  actualPriceMinor: number | null;
  notes: string | null;
  addedByMemberId: string | null;
}

export interface ShoppingListView {
  id: string;
  name: string;
  store: string | null;
  status: ShoppingListStatus;
  shopperMemberId: string | null;
  completedAt: string | null;
  itemCount: number;
  purchasedCount: number;
  /** What the list is likely to cost, from inventory price estimates. */
  estimatedTotalMinor: number;
  items?: ShoppingItemView[];
  createdAt: string;
}

export interface TripResult {
  list: ShoppingListView;
  tripId: string;
  expense: ExpenseView | null;
  itemsPurchased: number;
  itemsRestocked: number;
}

export class ShoppingService {
  constructor(
    private readonly db: Database,
    private readonly expenses: ExpenseService,
    private readonly inventory: InventoryService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /* ------------------------------------------------------------- lists --- */

  async listLists(ctx: RequestContext, query: ListShoppingListsQuery) {
    assertCan(ctx, 'shopping:read');

    const where = and(
      eq(shoppingLists.householdId, ctx.household.id),
      isNull(shoppingLists.deletedAt),
      query.status ? eq(shoppingLists.status, query.status) : undefined,
    );

    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(shoppingLists)
        .where(where)
        // Open lists first: the one you are about to shop matters most.
        .orderBy(asc(shoppingLists.status), desc(shoppingLists.createdAt))
        .limit(query.perPage)
        .offset(offsetOf(query)),
      this.db.select({ value: count() }).from(shoppingLists).where(where),
    ]);

    const counts = await this.countsFor(rows.map((r) => r.id));
    return paginated(
      rows.map((row) => toListView(row, counts.get(row.id))),
      totals[0]?.value ?? 0,
      query,
    );
  }

  async getList(ctx: RequestContext, listId: string): Promise<ShoppingListView> {
    assertCan(ctx, 'shopping:read');
    const list = await this.findList(ctx, listId);
    const items = await this.itemsFor(listId);
    const counts = await this.countsFor([listId]);
    return { ...toListView(list, counts.get(listId)), items };
  }

  async createList(ctx: RequestContext, input: CreateShoppingListInput): Promise<ShoppingListView> {
    assertCan(ctx, 'shopping:create');

    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(shoppingLists)
        .values({
          householdId: ctx.household.id,
          name: input.name,
          store: input.store ?? null,
          shopperMemberId: input.shopperMemberId ?? null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();

      await writeAudit(tx, ctx, {
        entityType: 'shopping_list',
        entityId: row!.id,
        action: 'create',
        summary: `Started shopping list "${row!.name}"`,
      });
      return row!;
    });

    return toListView(created, undefined);
  }

  async updateList(
    ctx: RequestContext,
    listId: string,
    input: UpdateShoppingListInput,
  ): Promise<ShoppingListView> {
    assertCan(ctx, 'shopping:update');
    const existing = await this.findList(ctx, listId);

    const updated = await this.db.transaction(async (tx) => {
      const changes = diffFields(existing as unknown as Record<string, unknown>, input);
      if (!changes) return existing;

      const [row] = await tx
        .update(shoppingLists)
        .set({ ...input, updatedBy: ctx.user.id, updatedAt: this.now() })
        .where(eq(shoppingLists.id, listId))
        .returning();

      await writeAudit(tx, ctx, {
        entityType: 'shopping_list',
        entityId: listId,
        action: 'update',
        changes,
      });
      return row!;
    });

    const counts = await this.countsFor([listId]);
    return toListView(updated, counts.get(listId));
  }

  async removeList(ctx: RequestContext, listId: string): Promise<void> {
    assertCan(ctx, 'shopping:delete');
    const existing = await this.findList(ctx, listId);

    await this.db.transaction(async (tx) => {
      await tx
        .update(shoppingLists)
        .set({ deletedAt: this.now(), updatedBy: ctx.user.id })
        .where(eq(shoppingLists.id, listId));
      await writeAudit(tx, ctx, {
        entityType: 'shopping_list',
        entityId: listId,
        action: 'delete',
        summary: `Deleted shopping list "${existing.name}"`,
      });
    });
  }

  /* ------------------------------------------------------------- items --- */

  async addItem(
    ctx: RequestContext,
    listId: string,
    input: AddShoppingItemInput,
  ): Promise<ShoppingItemView> {
    assertCan(ctx, 'shopping:update');
    const list = await this.findList(ctx, listId);
    if (list.status !== 'open') {
      throw new ConflictError('That list has already been completed');
    }

    // Linking to inventory is what lets the trip restock automatically; an
    // ad-hoc item is just a line on the list.
    let linked: typeof inventoryItems.$inferSelect | undefined;
    if (input.inventoryItemId) {
      linked = await this.db.query.inventoryItems.findFirst({
        where: and(
          eq(inventoryItems.id, input.inventoryItemId),
          eq(inventoryItems.householdId, ctx.household.id),
          isNull(inventoryItems.deletedAt),
        ),
      });
      if (!linked) {
        throw new ValidationError('That item is not in your inventory', [
          { path: 'inventoryItemId', message: 'Unknown item' },
        ]);
      }
    }

    const [row] = await this.db
      .insert(shoppingListItems)
      .values({
        householdId: ctx.household.id,
        listId,
        inventoryItemId: linked?.id ?? null,
        nameSnapshot: input.name ?? linked!.name,
        category: input.category ?? linked?.category ?? 'other',
        quantity: String(input.quantity),
        unit: input.unit ?? linked?.unit ?? 'piece',
        priority: input.priority,
        notes: input.notes ?? null,
        addedByMemberId: ctx.member.id,
      })
      .returning();

    return toItemView(row!);
  }

  async updateItem(
    ctx: RequestContext,
    listId: string,
    itemId: string,
    input: UpdateShoppingItemInput,
  ): Promise<ShoppingItemView> {
    assertCan(ctx, 'shopping:update');
    await this.findList(ctx, listId);

    // The numeric column takes a string on write, so it is pulled out of the
    // spread rather than colliding with it.
    const { quantity, ...rest } = input;

    const [row] = await this.db
      .update(shoppingListItems)
      .set({
        ...rest,
        ...(quantity !== undefined ? { quantity: String(quantity) } : {}),
        updatedAt: this.now(),
      })
      .where(
        and(
          eq(shoppingListItems.id, itemId),
          eq(shoppingListItems.listId, listId),
          eq(shoppingListItems.householdId, ctx.household.id),
        ),
      )
      .returning();

    if (!row) throw new NotFoundError('Shopping list item');
    return toItemView(row);
  }

  async removeItem(ctx: RequestContext, listId: string, itemId: string): Promise<void> {
    assertCan(ctx, 'shopping:update');
    await this.findList(ctx, listId);

    // A line on a list is not history; it hard-deletes.
    const deleted = await this.db
      .delete(shoppingListItems)
      .where(
        and(
          eq(shoppingListItems.id, itemId),
          eq(shoppingListItems.listId, listId),
          eq(shoppingListItems.householdId, ctx.household.id),
        ),
      )
      .returning({ id: shoppingListItems.id });

    if (deleted.length === 0) throw new NotFoundError('Shopping list item');
  }

  /**
   * Pulls everything running low (and, by default, anything past its usual
   * restock cadence) onto the list in one action.
   *
   * This is the answer to the decay problem in docs/16 §A: the user is never
   * asked to remember what is low, so the inventory earns its keep.
   */
  async addLowStock(
    ctx: RequestContext,
    listId: string,
    input: AddLowStockInput,
  ): Promise<{ added: number; items: ShoppingItemView[] }> {
    assertCan(ctx, 'shopping:update');
    const list = await this.findList(ctx, listId);
    if (list.status !== 'open') throw new ConflictError('That list has already been completed');

    const today = todayIn(ctx.household.timezone, this.now());

    const candidates = await this.inventory.needsRestocking(this.db, ctx.household.id, today, {
      includeRestockDue: input.includeRestockDue,
    });
    if (candidates.length === 0) return { added: 0, items: [] };

    // Skip anything already on this list, so pressing the button twice is safe.
    const existing = await this.db
      .select({ inventoryItemId: shoppingListItems.inventoryItemId })
      .from(shoppingListItems)
      .where(eq(shoppingListItems.listId, listId));
    const alreadyOnList = new Set(existing.map((r) => r.inventoryItemId).filter(Boolean));

    const toAdd = candidates.filter((item) => !alreadyOnList.has(item.id));
    if (toAdd.length === 0) return { added: 0, items: [] };

    const rows = await this.db
      .insert(shoppingListItems)
      .values(
        toAdd.map((item) => ({
          householdId: ctx.household.id,
          listId,
          inventoryItemId: item.id,
          nameSnapshot: item.name,
          category: item.category,
          // Buy back up to the threshold, or one unit when there is no threshold.
          quantity: String(suggestedQuantity(item)),
          unit: item.unit,
          priority: 'normal' as const,
          addedByMemberId: ctx.member.id,
        })),
      )
      .returning();

    return { added: rows.length, items: rows.map(toItemView) };
  }

  /* -------------------------------------------------------------- trip --- */

  /**
   * Completes a shopping trip. One transaction, four effects — see the file
   * header for why this is not three client-side calls.
   */
  async completeTrip(
    ctx: RequestContext,
    listId: string,
    input: CompleteTripInput,
  ): Promise<TripResult> {
    assertCan(ctx, 'shopping:update');
    if (input.recordExpense) assertCan(ctx, 'expense:create');

    const shoppedOn = input.shoppedOn ?? todayIn(ctx.household.timezone, this.now());

    const result = await this.db.transaction(async (tx) => {
      const list = await tx.query.shoppingLists.findFirst({
        where: and(
          eq(shoppingLists.id, listId),
          eq(shoppingLists.householdId, ctx.household.id),
          isNull(shoppingLists.deletedAt),
        ),
      });
      if (!list) throw new NotFoundError('Shopping list');
      // Completing twice would double-restock inventory and double-count spend.
      if (list.status !== 'open') throw new ConflictError('That list has already been completed');

      const items = await tx
        .select()
        .from(shoppingListItems)
        .where(eq(shoppingListItems.listId, listId));

      if (items.length === 0) {
        throw new ValidationError('There is nothing on this list to buy');
      }

      // Omitting the list means "we bought everything on it", which is the
      // common case and saves the shopper ticking every line.
      const purchasedIds = new Set(input.purchasedItemIds ?? items.map((i) => i.id));
      const prices = new Map(input.itemPrices?.map((p) => [p.itemId, p.actualPriceMinor]) ?? []);

      const unknownId = [...purchasedIds].find((id) => !items.some((i) => i.id === id));
      if (unknownId) {
        throw new ValidationError('One of those items is not on this list', [
          { path: 'purchasedItemIds', message: 'Unknown item' },
        ]);
      }

      const purchased = items.filter((item) => purchasedIds.has(item.id));

      // 1. Record what was bought, and for how much.
      for (const item of purchased) {
        await tx
          .update(shoppingListItems)
          .set({
            isPurchased: true,
            actualPriceMinor: prices.get(item.id) ?? item.actualPriceMinor,
            updatedAt: this.now(),
          })
          .where(eq(shoppingListItems.id, item.id));
      }

      // 2. Restock inventory — only for items that are actually tracked.
      let itemsRestocked = 0;
      if (input.restockInventory) {
        for (const item of purchased) {
          if (!item.inventoryItemId) continue;
          await this.inventory.restockWithin(
            tx,
            item.inventoryItemId,
            Number(item.quantity),
            shoppedOn,
          );
          itemsRestocked += 1;
        }
      }

      // 3. Record the spend, through the expenses service rather than its table.
      let expense: ExpenseView | null = null;
      if (input.recordExpense && input.amountMinor !== undefined) {
        expense = await this.expenses.createWithin(tx, ctx, {
          amountMinor: input.amountMinor,
          spentOn: shoppedOn,
          category: input.expenseCategory,
          paymentMethod: input.paymentMethod,
          paidByMemberId: input.paidByMemberId ?? list.shopperMemberId ?? ctx.member.id,
          merchant: input.merchant ?? list.store ?? undefined,
          description: `Shopping: ${list.name}`,
        });
      }

      // 4. Record the trip and close the list.
      const [trip] = await tx
        .insert(shoppingTrips)
        .values({
          householdId: ctx.household.id,
          listId,
          expenseId: expense?.id ?? null,
          shopperMemberId: list.shopperMemberId ?? ctx.member.id,
          store: list.store,
          totalMinor: input.amountMinor ?? null,
          itemsPurchased: purchased.length,
          shoppedOn,
          createdBy: ctx.user.id,
        })
        .returning();

      const [closed] = await tx
        .update(shoppingLists)
        .set({
          status: 'completed',
          completedAt: this.now(),
          updatedBy: ctx.user.id,
          updatedAt: this.now(),
        })
        .where(eq(shoppingLists.id, listId))
        .returning();

      await writeAudit(tx, ctx, {
        entityType: 'shopping_list',
        entityId: listId,
        action: 'update',
        summary:
          `Completed "${list.name}": ${purchased.length} item(s) bought` +
          (itemsRestocked > 0 ? `, ${itemsRestocked} restocked` : '') +
          (expense ? `, ${expense.currency} ${(expense.amountMinor / 100).toFixed(2)} recorded` : ''),
      });

      return {
        list: closed!,
        tripId: trip!.id,
        expense,
        itemsPurchased: purchased.length,
        itemsRestocked,
      };
    });

    const counts = await this.countsFor([listId]);
    return {
      list: toListView(result.list, counts.get(listId)),
      tripId: result.tripId,
      expense: result.expense,
      itemsPurchased: result.itemsPurchased,
      itemsRestocked: result.itemsRestocked,
    };
  }

  /* ----------------------------------------------------------- helpers --- */

  private async findList(ctx: RequestContext, listId: string) {
    const row = await this.db.query.shoppingLists.findFirst({
      where: and(
        eq(shoppingLists.id, listId),
        eq(shoppingLists.householdId, ctx.household.id),
        isNull(shoppingLists.deletedAt),
      ),
    });
    if (!row) throw new NotFoundError('Shopping list');
    return row;
  }

  private async itemsFor(listId: string): Promise<ShoppingItemView[]> {
    const rows = await this.db
      .select()
      .from(shoppingListItems)
      .where(eq(shoppingListItems.listId, listId))
      // Grouped by category, which is roughly aisle order while shopping.
      .orderBy(asc(shoppingListItems.category), asc(shoppingListItems.nameSnapshot));
    return rows.map(toItemView);
  }

  private async countsFor(listIds: string[]) {
    const map = new Map<string, { itemCount: number; purchasedCount: number; estimatedTotalMinor: number }>();
    if (listIds.length === 0) return map;

    const rows = await this.db
      .select({
        listId: shoppingListItems.listId,
        itemCount: count(),
        purchasedCount: sql<number>`count(*) filter (where ${shoppingListItems.isPurchased})::int`,
        estimatedTotalMinor: sql<number>`coalesce(sum(
          coalesce(${shoppingListItems.actualPriceMinor},
                   ${inventoryItems.estimatedPriceMinor} * ${shoppingListItems.quantity})
        ), 0)::bigint`,
      })
      .from(shoppingListItems)
      .leftJoin(inventoryItems, eq(inventoryItems.id, shoppingListItems.inventoryItemId))
      .where(inArray(shoppingListItems.listId, listIds))
      .groupBy(shoppingListItems.listId);

    for (const row of rows) {
      map.set(row.listId, {
        itemCount: row.itemCount,
        purchasedCount: row.purchasedCount,
        estimatedTotalMinor: Number(row.estimatedTotalMinor),
      });
    }
    return map;
  }
}

/** Buy back up to the threshold, or one unit when there is no threshold set. */
function suggestedQuantity(item: typeof inventoryItems.$inferSelect): number {
  const quantity = Number(item.quantity);
  const min = item.minQuantity === null ? null : Number(item.minQuantity);
  if (min === null) return 1;
  return Math.max(1, Math.ceil(min * 2 - quantity));
}

function toListView(
  row: typeof shoppingLists.$inferSelect,
  counts: { itemCount: number; purchasedCount: number; estimatedTotalMinor: number } | undefined,
): ShoppingListView {
  return {
    id: row.id,
    name: row.name,
    store: row.store,
    status: row.status,
    shopperMemberId: row.shopperMemberId,
    completedAt: row.completedAt?.toISOString() ?? null,
    itemCount: counts?.itemCount ?? 0,
    purchasedCount: counts?.purchasedCount ?? 0,
    estimatedTotalMinor: counts?.estimatedTotalMinor ?? 0,
    createdAt: row.createdAt.toISOString(),
  };
}

function toItemView(row: typeof shoppingListItems.$inferSelect): ShoppingItemView {
  return {
    id: row.id,
    inventoryItemId: row.inventoryItemId,
    name: row.nameSnapshot,
    category: row.category,
    quantity: Number(row.quantity),
    unit: row.unit,
    priority: row.priority,
    isPurchased: row.isPurchased,
    actualPriceMinor: row.actualPriceMinor === null ? null : Number(row.actualPriceMinor),
    notes: row.notes,
    addedByMemberId: row.addedByMemberId,
  };
}
