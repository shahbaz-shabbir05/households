import { describe, expect, it } from 'vitest';
import { countRestockable, resolvePurchasedIds, type TripCandidate } from '../features/shopping/trip.js';

const item = (id: string, isPurchased = false, inventoryItemId: string | null = 'inv'): TripCandidate => ({
  id,
  isPurchased,
  inventoryItemId,
});

describe('what a trip counts as bought', () => {
  it('uses the ticked items when the shopper ticked as they went', () => {
    const items = [item('a', true), item('b', false), item('c', true)];
    expect(resolvePurchasedIds(items)).toEqual(['a', 'c']);
  });

  it('assumes the whole list when nothing was ticked', () => {
    // Treating "ticked nothing" as "bought nothing" would close the list
    // without restocking anything — the opposite of what happened.
    const items = [item('a'), item('b')];
    expect(resolvePurchasedIds(items)).toEqual(['a', 'b']);
  });

  it('returns nothing for an empty list', () => {
    expect(resolvePurchasedIds([])).toEqual([]);
  });
});

describe('how many purchased items move stock', () => {
  it('counts only the ones linked to inventory', () => {
    const items = [item('a', true), item('b', true, null), item('c', true)];
    expect(countRestockable(items, resolvePurchasedIds(items))).toBe(2);
  });

  it('ignores items that were not bought', () => {
    const items = [item('a', true), item('b', false)];
    expect(countRestockable(items, resolvePurchasedIds(items))).toBe(1);
  });

  it('is zero when nothing on the list is tracked', () => {
    const items = [item('a', true, null), item('b', true, null)];
    expect(countRestockable(items, resolvePurchasedIds(items))).toBe(0);
  });
});
