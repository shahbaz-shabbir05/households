/**
 * Shopping's dashboard contribution: what is running low, and any open list.
 *
 * This is the suggestion in docs/02 §J4 — "Milk is low, add to the list?" —
 * surfaced where the user already looks, rather than in a screen they have to
 * remember to visit.
 */

import { and, asc, eq, isNull } from 'drizzle-orm';
import { inventoryItems, shoppingLists } from '../../db/schema/index.js';
import { can } from '../../core/policy/index.js';
import type { DashboardContributor, DashboardItem } from '../dashboard/types.js';
import type { InventoryService } from '../inventory/service.js';

export function createShoppingDashboardContributor(
  inventory: InventoryService,
): DashboardContributor {
  return {
    name: 'shopping',

    async collect(db, ctx, window) {
      if (!can(ctx, 'inventory:read')) return [];

      const [lowStock, openLists] = await Promise.all([
        inventory.needsRestocking(db, ctx.household.id, window.today, { limit: 12 }),
        db
          .select()
          .from(shoppingLists)
          .where(
            and(
              eq(shoppingLists.householdId, ctx.household.id),
              eq(shoppingLists.status, 'open'),
              isNull(shoppingLists.deletedAt),
            ),
          )
          .orderBy(asc(shoppingLists.createdAt))
          .limit(3),
      ]);

      const items: DashboardItem[] = [];

      if (lowStock.length > 0) {
        // Coalesced into one row. Twelve separate "X is low" lines would bury
        // everything else on the dashboard (docs/09).
        const names = lowStock.slice(0, 3).map((i) => i.name).join(', ');
        const more = lowStock.length > 3 ? ` and ${lowStock.length - 3} more` : '';
        items.push({
          id: `low-stock-${ctx.household.id}`,
          entityType: 'inventory_item',
          title: `${lowStock.length} item${lowStock.length === 1 ? '' : 's'} running low`,
          subtitle: `${names}${more}`,
          date: window.today,
          priority: 'normal',
          isOverdue: false,
          quickAction: 'shopping:add-low-stock',
        });
      }

      for (const list of openLists) {
        items.push({
          id: list.id,
          entityType: 'shopping_list',
          title: list.name,
          subtitle: list.store ? `Shopping list · ${list.store}` : 'Shopping list',
          date: window.today,
          priority: 'low',
          isOverdue: false,
          quickAction: 'shopping:open',
        });
      }

      return items;
    },
  };
}

export { inventoryItems };
