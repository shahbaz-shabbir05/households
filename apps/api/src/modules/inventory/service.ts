/**
 * Household inventory — groceries and supplies in one table (docs/01).
 *
 * The decay problem is the real risk here: an inventory that says you have rice
 * when you do not is worse than no inventory (docs/16 §A). The mitigation is
 * that stock is *derived* wherever possible — a completed shopping trip
 * restocks it automatically — rather than relying on manual upkeep.
 */

import { and, asc, count, desc, eq, ilike, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  addDays,
  type CivilDate,
  type CreateInventoryItemInput,
  type InventoryCategory,
  type InventoryKind,
  type ListInventoryQuery,
  type UpdateInventoryItemInput,
  type Unit,
} from '@hms/shared';
import { inventoryItems } from '../../db/schema/index.js';
import type { Database, DbExecutor } from '../../db/client.js';
import { ConflictError, NotFoundError, PG_UNIQUE_VIOLATION, pgErrorCode } from '../../core/errors.js';
import { diffFields, writeAudit } from '../../core/audit.js';
import { assertCan } from '../../core/policy/index.js';
import type { RequestContext } from '../../core/request-context.js';
import { todayIn } from '../../core/time.js';
import { offsetOf, paginated } from '../../core/pagination.js';

export interface InventoryItemView {
  id: string;
  name: string;
  kind: InventoryKind;
  category: InventoryCategory;
  unit: Unit;
  quantity: number;
  minQuantity: number | null;
  location: string | null;
  expiryDate: string | null;
  brand: string | null;
  preferredBrand: string | null;
  estimatedPriceMinor: number | null;
  restockIntervalDays: number | null;
  lastPurchasedOn: string | null;
  notes: string | null;
  /** At or below the threshold. */
  isLow: boolean;
  /** Past its usual restock cadence, even if stock has not been decremented. */
  isRestockDue: boolean;
  isExpired: boolean;
  createdAt: string;
}

export class InventoryService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(ctx: RequestContext, query: ListInventoryQuery) {
    assertCan(ctx, 'inventory:read');
    const today = todayIn(ctx.household.timezone, this.now());

    const where = and(
      eq(inventoryItems.householdId, ctx.household.id),
      isNull(inventoryItems.deletedAt),
      ...this.filters(query, today),
    );

    const orderColumn = {
      name: inventoryItems.name,
      category: inventoryItems.category,
      quantity: inventoryItems.quantity,
      expiryDate: inventoryItems.expiryDate,
    }[query.sort];

    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(inventoryItems)
        .where(where)
        .orderBy(query.order === 'asc' ? asc(orderColumn) : desc(orderColumn), asc(inventoryItems.name))
        .limit(query.perPage)
        .offset(offsetOf(query)),
      this.db.select({ value: count() }).from(inventoryItems).where(where),
    ]);

    return paginated(rows.map((row) => toView(row, today)), totals[0]?.value ?? 0, query);
  }

  /**
   * Everything the household should probably buy: at or below threshold, or
   * past its usual restock cadence. This is what the dashboard suggestion and
   * the "add low stock to list" action both read.
   */
  async needsRestocking(
    db: DbExecutor,
    householdId: string,
    today: CivilDate,
    options: { includeRestockDue?: boolean; limit?: number } = {},
  ): Promise<Array<typeof inventoryItems.$inferSelect>> {
    const lowStock = and(
      isNotNull(inventoryItems.minQuantity),
      sql`${inventoryItems.quantity} <= ${inventoryItems.minQuantity}`,
    )!;

    const restockDue = and(
      isNotNull(inventoryItems.restockIntervalDays),
      isNotNull(inventoryItems.lastPurchasedOn),
      sql`(${inventoryItems.lastPurchasedOn}::date + ${inventoryItems.restockIntervalDays}) <= ${today}::date`,
    )!;

    return db
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.householdId, householdId),
          isNull(inventoryItems.deletedAt),
          options.includeRestockDue === false ? lowStock : or(lowStock, restockDue),
        ),
      )
      .orderBy(asc(inventoryItems.category), asc(inventoryItems.name))
      .limit(options.limit ?? 100);
  }

  async get(ctx: RequestContext, itemId: string): Promise<InventoryItemView> {
    assertCan(ctx, 'inventory:read');
    const row = await this.find(ctx, itemId);
    return toView(row, todayIn(ctx.household.timezone, this.now()));
  }

  async create(ctx: RequestContext, input: CreateInventoryItemInput): Promise<InventoryItemView> {
    assertCan(ctx, 'inventory:create');
    const today = todayIn(ctx.household.timezone, this.now());

    const created = await this.db.transaction(async (tx) => {
      try {
        const [row] = await tx
          .insert(inventoryItems)
          .values({
            householdId: ctx.household.id,
            name: input.name,
            kind: input.kind,
            category: input.category,
            unit: input.unit,
            quantity: String(input.quantity),
            minQuantity: input.minQuantity != null ? String(input.minQuantity) : null,
            location: input.location ?? null,
            expiryDate: input.expiryDate ?? null,
            brand: input.brand ?? null,
            preferredBrand: input.preferredBrand ?? null,
            estimatedPriceMinor: input.estimatedPriceMinor ?? null,
            restockIntervalDays: input.restockIntervalDays ?? null,
            notes: input.notes ?? null,
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id,
          })
          .returning();

        await writeAudit(tx, ctx, {
          entityType: 'inventory_item',
          entityId: row!.id,
          action: 'create',
          summary: `Added "${row!.name}" to inventory`,
        });
        return row!;
      } catch (error) {
        // One entry per named thing, so "Milk" and "milk" cannot drift apart.
        if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
          throw new ConflictError(`"${input.name}" is already in your inventory`);
        }
        throw error;
      }
    });

    return toView(created, today);
  }

  async update(
    ctx: RequestContext,
    itemId: string,
    input: UpdateInventoryItemInput,
  ): Promise<InventoryItemView> {
    assertCan(ctx, 'inventory:update');
    const existing = await this.find(ctx, itemId);
    const today = todayIn(ctx.household.timezone, this.now());

    // Numeric columns take strings on write, so they are pulled out of the
    // spread rather than colliding with it.
    const { quantity, minQuantity, ...rest } = input;

    const updated = await this.db.transaction(async (tx) => {
      const changes = diffFields(existing as unknown as Record<string, unknown>, input);
      if (!changes) return existing;

      const [row] = await tx
        .update(inventoryItems)
        .set({
          ...rest,
          ...(quantity !== undefined ? { quantity: String(quantity) } : {}),
          ...(minQuantity !== undefined
            ? { minQuantity: minQuantity === null ? null : String(minQuantity) }
            : {}),
          updatedBy: ctx.user.id,
          updatedAt: this.now(),
        })
        .where(eq(inventoryItems.id, itemId))
        .returning();

      await writeAudit(tx, ctx, {
        entityType: 'inventory_item',
        entityId: itemId,
        action: 'update',
        changes,
      });
      return row!;
    });

    return toView(updated, today);
  }

  /**
   * Adjusts stock. Separate from `update` because "we used two" and "we now
   * have two" are different statements — conflating them is how an inventory
   * silently drifts out of step with reality.
   */
  async adjust(
    ctx: RequestContext,
    itemId: string,
    input: { delta?: number; setTo?: number; reason?: string },
  ): Promise<InventoryItemView> {
    assertCan(ctx, 'inventory:update');
    const existing = await this.find(ctx, itemId);
    const today = todayIn(ctx.household.timezone, this.now());

    // Clamped at zero: a negative stock level is never meaningful, and the
    // CHECK constraint would reject it anyway.
    const next =
      input.setTo !== undefined
        ? input.setTo
        : Math.max(0, Number(existing.quantity) + (input.delta ?? 0));

    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(inventoryItems)
        .set({ quantity: String(next), updatedBy: ctx.user.id, updatedAt: this.now() })
        .where(eq(inventoryItems.id, itemId))
        .returning();

      await writeAudit(tx, ctx, {
        entityType: 'inventory_item',
        entityId: itemId,
        action: 'update',
        summary: input.reason ?? `Stock changed from ${existing.quantity} to ${next}`,
        changes: { quantity: { from: Number(existing.quantity), to: next } },
      });
      return row!;
    });

    return toView(updated, today);
  }

  /**
   * Adds stock after a purchase. Called by the shopping module inside its own
   * transaction, so a failed trip never half-restocks.
   */
  async restockWithin(
    tx: DbExecutor,
    itemId: string,
    quantity: number,
    purchasedOn: CivilDate,
  ): Promise<void> {
    await tx
      .update(inventoryItems)
      .set({
        quantity: sql`${inventoryItems.quantity} + ${String(quantity)}`,
        lastPurchasedOn: purchasedOn,
        updatedAt: this.now(),
      })
      .where(eq(inventoryItems.id, itemId));
  }

  async remove(ctx: RequestContext, itemId: string): Promise<void> {
    assertCan(ctx, 'inventory:delete');
    const existing = await this.find(ctx, itemId);

    await this.db.transaction(async (tx) => {
      await tx
        .update(inventoryItems)
        .set({ deletedAt: this.now(), updatedBy: ctx.user.id })
        .where(eq(inventoryItems.id, itemId));
      await writeAudit(tx, ctx, {
        entityType: 'inventory_item',
        entityId: itemId,
        action: 'delete',
        summary: `Removed "${existing.name}" from inventory`,
      });
    });
  }

  private filters(query: ListInventoryQuery, today: CivilDate): SQL[] {
    const filters: SQL[] = [];
    if (query.kind) filters.push(eq(inventoryItems.kind, query.kind));
    if (query.category) filters.push(eq(inventoryItems.category, query.category));

    if (query.lowStock) {
      filters.push(
        and(
          isNotNull(inventoryItems.minQuantity),
          sql`${inventoryItems.quantity} <= ${inventoryItems.minQuantity}`,
        )!,
      );
    }

    if (query.expiringWithinDays !== undefined) {
      filters.push(
        and(
          isNotNull(inventoryItems.expiryDate),
          lte(inventoryItems.expiryDate, addDays(today, query.expiringWithinDays)),
        )!,
      );
    }

    if (query.search) {
      const term = `%${query.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      filters.push(or(ilike(inventoryItems.name, term), ilike(inventoryItems.brand, term))!);
    }
    return filters;
  }

  private async find(ctx: RequestContext, itemId: string) {
    const row = await this.db.query.inventoryItems.findFirst({
      where: and(
        eq(inventoryItems.id, itemId),
        eq(inventoryItems.householdId, ctx.household.id),
        isNull(inventoryItems.deletedAt),
      ),
    });
    if (!row) throw new NotFoundError('Inventory item');
    return row;
  }
}

export function toView(
  row: typeof inventoryItems.$inferSelect,
  today: CivilDate,
): InventoryItemView {
  const quantity = Number(row.quantity);
  const minQuantity = row.minQuantity === null ? null : Number(row.minQuantity);

  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    category: row.category,
    unit: row.unit,
    quantity,
    minQuantity,
    location: row.location,
    expiryDate: row.expiryDate,
    brand: row.brand,
    preferredBrand: row.preferredBrand,
    estimatedPriceMinor: row.estimatedPriceMinor === null ? null : Number(row.estimatedPriceMinor),
    restockIntervalDays: row.restockIntervalDays,
    lastPurchasedOn: row.lastPurchasedOn,
    notes: row.notes,
    isLow: minQuantity !== null && quantity <= minQuantity,
    isRestockDue:
      row.restockIntervalDays !== null &&
      row.lastPurchasedOn !== null &&
      addDays(row.lastPurchasedOn, row.restockIntervalDays) <= today,
    isExpired: row.expiryDate !== null && row.expiryDate < today,
    createdAt: row.createdAt.toISOString(),
  };
}
