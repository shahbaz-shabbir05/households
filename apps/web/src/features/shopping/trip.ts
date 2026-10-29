/**
 * Which items a trip counts as bought.
 *
 * A shopper ticks items as they go, so the ticked set is the truth at the
 * till. But a shopper who ticked nothing has almost certainly bought the whole
 * list rather than nothing at all — treating an empty tick-set as "bought
 * nothing" would silently close the list without restocking anything.
 */

export interface TripCandidate {
  id: string;
  isPurchased: boolean;
  inventoryItemId: string | null;
}

export function resolvePurchasedIds(items: TripCandidate[]): string[] {
  const ticked = items.filter((item) => item.isPurchased);
  return (ticked.length > 0 ? ticked : items).map((item) => item.id);
}

/** How many of the purchased items will actually move stock. */
export function countRestockable(items: TripCandidate[], purchasedIds: string[]): number {
  const purchased = new Set(purchasedIds);
  return items.filter((item) => purchased.has(item.id) && item.inventoryItemId !== null).length;
}
