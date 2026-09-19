import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Agent, closeTestApp, createTestApp, shutdownTestDatabase, type TestApp } from '../../test/setup.js';
import { seedHousehold, type SeededHousehold } from '../../test/factories.js';

let test: TestApp;
let home: SeededHousehold;
let base: string;

const inventoryUrl = () => `${base}/inventory`;
const listsUrl = () => `${base}/shopping-lists`;

beforeEach(async () => {
  test = await createTestApp();
  test.setNow(new Date('2026-03-10T06:00:00Z')); // 11:00 in Karachi
  home = await seedHousehold(test);
  base = `/api/v1/households/${home.householdId}`;
});
afterEach(async () => {
  await closeTestApp(test);
});
afterAll(async () => {
  await shutdownTestDatabase();
});

/** Adds an inventory item and returns its view. */
async function addInventory(over: Record<string, unknown> = {}) {
  const response = await home.admin.agent.post(inventoryUrl(), {
    name: 'Milk',
    category: 'dairy',
    unit: 'litre',
    quantity: 1,
    minQuantity: 2,
    estimatedPriceMinor: 25000,
    ...over,
  });
  if (response.statusCode !== 201) throw new Error(`addInventory failed: ${response.body}`);
  return response.json().data;
}

async function newList(over: Record<string, unknown> = {}) {
  const response = await home.admin.agent.post(listsUrl(), { name: 'Weekly shop', ...over });
  if (response.statusCode !== 201) throw new Error(`newList failed: ${response.body}`);
  return response.json().data;
}

describe('inventory', () => {
  it('flags an item as low when it is at or below its threshold', async () => {
    const low = await addInventory({ name: 'Milk', quantity: 1, minQuantity: 2 });
    const fine = await addInventory({ name: 'Rice', quantity: 10, minQuantity: 2 });

    expect(low.isLow).toBe(true);
    expect(fine.isLow).toBe(false);
  });

  it('treats exactly-at-threshold as low, not as fine', async () => {
    // "We have exactly the minimum" is the moment to buy more, not after.
    const item = await addInventory({ name: 'Sugar', quantity: 2, minQuantity: 2 });
    expect(item.isLow).toBe(true);
  });

  it('never flags an item with no threshold', async () => {
    const item = await addInventory({ name: 'Saffron', quantity: 0, minQuantity: null });
    expect(item.isLow).toBe(false);
  });

  it('keeps fractional quantities as numbers, not strings', async () => {
    const item = await addInventory({ name: 'Basmati rice', quantity: 2.5, unit: 'kg' });
    expect(item.quantity).toBe(2.5);
    expect(typeof item.quantity).toBe('number');
  });

  it('refuses a duplicate name regardless of case', async () => {
    await addInventory({ name: 'Milk' });
    const duplicate = await home.admin.agent.post(inventoryUrl(), { name: 'milk' });

    // Otherwise "Milk" and "milk" drift apart and both are half-right.
    expect(duplicate.statusCode).toBe(409);
  });

  it('adjusts stock by a delta, clamping at zero', async () => {
    const item = await addInventory({ name: 'Eggs', quantity: 6, unit: 'piece' });

    const used = await home.admin.agent.post(`${inventoryUrl()}/${item.id}/adjust`, { delta: -2 });
    expect(used.json().data.quantity).toBe(4);

    const overused = await home.admin.agent.post(`${inventoryUrl()}/${item.id}/adjust`, { delta: -99 });
    expect(overused.json().data.quantity).toBe(0);
  });

  it('adjusts stock to an absolute value', async () => {
    const item = await addInventory({ name: 'Flour', quantity: 1 });
    const counted = await home.admin.agent.post(`${inventoryUrl()}/${item.id}/adjust`, { setTo: 7.5 });
    expect(counted.json().data.quantity).toBe(7.5);
  });

  it('refuses an adjustment that is both a delta and an absolute', async () => {
    const item = await addInventory({ name: 'Oil' });
    const response = await home.admin.agent.post(`${inventoryUrl()}/${item.id}/adjust`, {
      delta: 1,
      setTo: 5,
    });
    expect(response.statusCode).toBe(400);
  });

  it('filters to low stock and to expiring items', async () => {
    await addInventory({ name: 'Milk', quantity: 1, minQuantity: 2 });
    await addInventory({ name: 'Rice', quantity: 10, minQuantity: 2 });
    await addInventory({ name: 'Yoghurt', quantity: 5, expiryDate: '2026-03-12' });

    const low = await home.admin.agent.get(`${inventoryUrl()}?lowStock=true`);
    expect(low.json().data.map((i: { name: string }) => i.name)).toEqual(['Milk']);

    const expiring = await home.admin.agent.get(`${inventoryUrl()}?expiringWithinDays=7`);
    expect(expiring.json().data.map((i: { name: string }) => i.name)).toEqual(['Yoghurt']);
  });

  it('marks an item due for restock by its usual cadence', async () => {
    const item = await addInventory({
      name: 'Rice',
      quantity: 10,
      minQuantity: null,
      restockIntervalDays: 7,
    });
    // Never purchased, so nothing to measure from yet.
    expect(item.isRestockDue).toBe(false);

    const list = await newList();
    await home.admin.agent.post(`${listsUrl()}/${list.id}/items`, { inventoryItemId: item.id });
    await home.admin.agent.post(`${listsUrl()}/${list.id}/complete`, {
      amountMinor: 50000,
      recordExpense: true,
    });

    // Ten days later it is past its cadence, even though stock never dropped.
    // (Kept inside the session TTL: advancing the clock past 30 days would
    // expire the session and test something else entirely.)
    test.setNow(new Date('2026-03-20T06:00:00Z'));
    const after = await home.admin.agent.get(`${inventoryUrl()}/${item.id}`);
    expect(after.json().data.lastPurchasedOn).toBe('2026-03-10');
    expect(after.json().data.isRestockDue).toBe(true);
  });
});

describe('shopping lists', () => {
  it('adds an item linked to inventory, inheriting its details', async () => {
    const milk = await addInventory({ name: 'Milk', category: 'dairy', unit: 'litre' });
    const list = await newList();

    const response = await home.admin.agent.post(`${listsUrl()}/${list.id}/items`, {
      inventoryItemId: milk.id,
      quantity: 2,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      name: 'Milk',
      category: 'dairy',
      unit: 'litre',
      quantity: 2,
      inventoryItemId: milk.id,
    });
  });

  it('adds an ad-hoc item with no inventory link', async () => {
    const list = await newList();
    const response = await home.admin.agent.post(`${listsUrl()}/${list.id}/items`, {
      name: 'Birthday candles',
      quantity: 1,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.inventoryItemId).toBeNull();
  });

  it('requires either a name or an inventory item', async () => {
    const list = await newList();
    const response = await home.admin.agent.post(`${listsUrl()}/${list.id}/items`, { quantity: 1 });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an inventory item from another household', async () => {
    const other = await seedHousehold(test);
    const theirItem = await other.admin.agent.post(
      `/api/v1/households/${other.householdId}/inventory`,
      { name: 'Their milk' },
    );
    const list = await newList();

    const response = await home.admin.agent.post(`${listsUrl()}/${list.id}/items`, {
      inventoryItemId: theirItem.json().data.id,
    });
    expect(response.statusCode).toBe(400);
  });

  it('estimates the list total from inventory prices', async () => {
    const milk = await addInventory({ name: 'Milk', estimatedPriceMinor: 25000 });
    const list = await newList();
    await home.admin.agent.post(`${listsUrl()}/${list.id}/items`, {
      inventoryItemId: milk.id,
      quantity: 2,
    });

    const fetched = await home.admin.agent.get(`${listsUrl()}/${list.id}`);
    expect(fetched.json().data.estimatedTotalMinor).toBe(50000);
  });

  it('groups items by category, which is roughly aisle order', async () => {
    const list = await newList();
    for (const [name, category] of [
      ['Bread', 'bakery'],
      ['Milk', 'dairy'],
      ['Bleach', 'cleaning'],
    ] as const) {
      await home.admin.agent.post(`${listsUrl()}/${list.id}/items`, { name, category });
    }

    const fetched = await home.admin.agent.get(`${listsUrl()}/${list.id}`);
    const categories = fetched.json().data.items.map((i: { category: string }) => i.category);
    expect(categories).toEqual([...categories].sort());
  });
});

describe('add low stock in one action', () => {
  it('pulls everything running low onto the list', async () => {
    await addInventory({ name: 'Milk', quantity: 1, minQuantity: 2 });
    await addInventory({ name: 'Eggs', quantity: 0, minQuantity: 6, unit: 'piece' });
    await addInventory({ name: 'Rice', quantity: 20, minQuantity: 2 });
    const list = await newList();

    const response = await home.admin.agent.post(`${listsUrl()}/${list.id}/add-low-stock`, {});
    expect(response.json().data.added).toBe(2);

    const fetched = await home.admin.agent.get(`${listsUrl()}/${list.id}`);
    const names = fetched.json().data.items.map((i: { name: string }) => i.name).sort();
    expect(names).toEqual(['Eggs', 'Milk']);
  });

  it('is safe to press twice', async () => {
    await addInventory({ name: 'Milk', quantity: 1, minQuantity: 2 });
    const list = await newList();

    await home.admin.agent.post(`${listsUrl()}/${list.id}/add-low-stock`, {});
    const second = await home.admin.agent.post(`${listsUrl()}/${list.id}/add-low-stock`, {});

    expect(second.json().data.added).toBe(0);
    const fetched = await home.admin.agent.get(`${listsUrl()}/${list.id}`);
    expect(fetched.json().data.items).toHaveLength(1);
  });

  it('suggests enough to get back above the threshold', async () => {
    await addInventory({ name: 'Eggs', quantity: 0, minQuantity: 6, unit: 'piece' });
    const list = await newList();
    await home.admin.agent.post(`${listsUrl()}/${list.id}/add-low-stock`, {});

    const fetched = await home.admin.agent.get(`${listsUrl()}/${list.id}`);
    // Buying exactly the minimum leaves you at the threshold, i.e. still "low".
    expect(fetched.json().data.items[0].quantity).toBe(12);
  });
});

describe('the shopping trip workflow', () => {
  it('marks purchased, restocks inventory, records the spend and closes the list', async () => {
    const milk = await addInventory({ name: 'Milk', quantity: 1, minQuantity: 2, unit: 'litre' });
    const eggs = await addInventory({ name: 'Eggs', quantity: 0, minQuantity: 6, unit: 'piece' });
    const list = await newList({ store: 'Imtiaz', name: 'Weekly shop' });

    await home.admin.agent.post(`${listsUrl()}/${list.id}/items`, {
      inventoryItemId: milk.id,
      quantity: 3,
    });
    await home.admin.agent.post(`${listsUrl()}/${list.id}/items`, {
      inventoryItemId: eggs.id,
      quantity: 12,
    });
    await home.admin.agent.post(`${listsUrl()}/${list.id}/items`, { name: 'Birthday candles' });

    const response = await home.admin.agent.post(`${listsUrl()}/${list.id}/complete`, {
      amountMinor: 487500,
      paymentMethod: 'jazzcash',
      recordExpense: true,
    });

    expect(response.statusCode).toBe(200);
    const result = response.json().data;
    expect(result.itemsPurchased).toBe(3);
    // Only the two tracked items restock; the ad-hoc one has nowhere to go.
    expect(result.itemsRestocked).toBe(2);
    expect(result.list.status).toBe('completed');

    // Inventory went up by what was bought.
    const milkAfter = await home.admin.agent.get(`${inventoryUrl()}/${milk.id}`);
    expect(milkAfter.json().data.quantity).toBe(4);
    expect(milkAfter.json().data.isLow).toBe(false);
    expect(milkAfter.json().data.lastPurchasedOn).toBe('2026-03-10');

    const eggsAfter = await home.admin.agent.get(`${inventoryUrl()}/${eggs.id}`);
    expect(eggsAfter.json().data.quantity).toBe(12);

    // And the spend is in the ledger, linked and attributed.
    expect(result.expense).toMatchObject({
      amountMinor: 487500,
      category: 'groceries',
      paymentMethod: 'jazzcash',
      merchant: 'Imtiaz',
      spentOn: '2026-03-10',
    });

    const expenses = await home.admin.agent.get(`${base}/expenses`);
    expect(expenses.json().data).toHaveLength(1);
    expect(expenses.json().data[0].description).toBe('Shopping: Weekly shop');
  });

  it('restocks only the items actually bought', async () => {
    const milk = await addInventory({ name: 'Milk', quantity: 1 });
    const rice = await addInventory({ name: 'Rice', quantity: 1 });
    const list = await newList();

    const milkItem = await home.admin.agent.post(`${listsUrl()}/${list.id}/items`, {
      inventoryItemId: milk.id,
      quantity: 2,
    });
    await home.admin.agent.post(`${listsUrl()}/${list.id}/items`, {
      inventoryItemId: rice.id,
      quantity: 5,
    });

    // Out of stock at the shop — only the milk was bought.
    await home.admin.agent.post(`${listsUrl()}/${list.id}/complete`, {
      purchasedItemIds: [milkItem.json().data.id],
      amountMinor: 50000,
    });

    expect((await home.admin.agent.get(`${inventoryUrl()}/${milk.id}`)).json().data.quantity).toBe(3);
    expect((await home.admin.agent.get(`${inventoryUrl()}/${rice.id}`)).json().data.quantity).toBe(1);
  });

  it('can close a list without recording a spend', async () => {
    const milk = await addInventory({ name: 'Milk', quantity: 1 });
    const list = await newList();
    await home.admin.agent.post(`${listsUrl()}/${list.id}/items`, {
      inventoryItemId: milk.id,
      quantity: 2,
    });

    const response = await home.admin.agent.post(`${listsUrl()}/${list.id}/complete`, {
      recordExpense: false,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.expense).toBeNull();
    // Inventory still restocks — someone else paying does not unbuy the milk.
    expect((await home.admin.agent.get(`${inventoryUrl()}/${milk.id}`)).json().data.quantity).toBe(3);
    expect((await home.admin.agent.get(`${base}/expenses`)).json().data).toHaveLength(0);
  });

  it('insists on an amount when an expense is being recorded', async () => {
    const list = await newList();
    await home.admin.agent.post(`${listsUrl()}/${list.id}/items`, { name: 'Something' });

    const response = await home.admin.agent.post(`${listsUrl()}/${list.id}/complete`, {
      recordExpense: true,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.details[0].path).toBe('amountMinor');
  });

  it('refuses to complete the same list twice', async () => {
    const milk = await addInventory({ name: 'Milk', quantity: 1 });
    const list = await newList();
    await home.admin.agent.post(`${listsUrl()}/${list.id}/items`, {
      inventoryItemId: milk.id,
      quantity: 2,
    });

    await home.admin.agent.post(`${listsUrl()}/${list.id}/complete`, { amountMinor: 50000 });
    const second = await home.admin.agent.post(`${listsUrl()}/${list.id}/complete`, {
      amountMinor: 50000,
    });

    // Otherwise inventory double-restocks and the spend is counted twice.
    expect(second.statusCode).toBe(409);
    expect((await home.admin.agent.get(`${inventoryUrl()}/${milk.id}`)).json().data.quantity).toBe(3);
    expect((await home.admin.agent.get(`${base}/expenses`)).json().data).toHaveLength(1);
  });

  it('refuses to complete an empty list', async () => {
    const list = await newList();
    const response = await home.admin.agent.post(`${listsUrl()}/${list.id}/complete`, {
      amountMinor: 1000,
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an item id that is not on the list', async () => {
    const list = await newList();
    const other = await newList({ name: 'Another list' });
    await home.admin.agent.post(`${listsUrl()}/${list.id}/items`, { name: 'On this list' });
    const strayItem = await home.admin.agent.post(`${listsUrl()}/${other.id}/items`, {
      name: 'On another list',
    });

    const response = await home.admin.agent.post(`${listsUrl()}/${list.id}/complete`, {
      purchasedItemIds: [strayItem.json().data.id],
      amountMinor: 1000,
    });
    expect(response.statusCode).toBe(400);
  });

  /**
   * The atomicity guarantee, tested by forcing a failure part-way through.
   * A partial success here would leave inventory restocked with no record of
   * the spend — exactly the corruption this endpoint exists to prevent.
   */
  it('rolls back everything when any step fails', async () => {
    const milk = await addInventory({ name: 'Milk', quantity: 1 });
    const list = await newList();
    await home.admin.agent.post(`${listsUrl()}/${list.id}/items`, {
      inventoryItemId: milk.id,
      quantity: 2,
    });

    // Break the expense write, which happens *after* items are marked and
    // inventory is restocked.
    const original = test.container.expenses.createWithin.bind(test.container.expenses);
    test.container.expenses.createWithin = async () => {
      throw new Error('simulated ledger failure');
    };

    const response = await home.admin.agent.post(`${listsUrl()}/${list.id}/complete`, {
      amountMinor: 50000,
    });
    test.container.expenses.createWithin = original;

    expect(response.statusCode).toBe(500);

    // Nothing moved: not the stock, not the list, not the items.
    expect((await home.admin.agent.get(`${inventoryUrl()}/${milk.id}`)).json().data.quantity).toBe(1);

    const reread = await home.admin.agent.get(`${listsUrl()}/${list.id}`);
    expect(reread.json().data.status).toBe('open');
    expect(reread.json().data.items[0].isPurchased).toBe(false);
    expect((await home.admin.agent.get(`${base}/expenses`)).json().data).toHaveLength(0);

    // And the list is still completable once the fault clears.
    const retry = await home.admin.agent.post(`${listsUrl()}/${list.id}/complete`, {
      amountMinor: 50000,
    });
    expect(retry.statusCode).toBe(200);
  });
});

describe('authorization and isolation', () => {
  it('lets a teen add to the list but not delete it or see the spend', async () => {
    const withLogins = await seedHousehold(test, { withLogins: ['teen'] });
    const teenBase = `/api/v1/households/${withLogins.householdId}`;
    const list = await withLogins.admin.agent.post(`${teenBase}/shopping-lists`, { name: 'Shop' });
    const listId = list.json().data.id;

    expect(
      (await withLogins.agents.teen!.post(`${teenBase}/shopping-lists/${listId}/items`, {
        name: 'Crisps',
      })).statusCode,
    ).toBe(201);

    expect(
      (await withLogins.agents.teen!.delete(`${teenBase}/shopping-lists/${listId}`)).statusCode,
    ).toBe(403);

    expect((await withLogins.agents.teen!.get(`${teenBase}/expenses`)).statusCode).toBe(403);
  });

  it('stops a teen completing a trip that would record a spend', async () => {
    const withLogins = await seedHousehold(test, { withLogins: ['teen'] });
    const teenBase = `/api/v1/households/${withLogins.householdId}`;
    const list = await withLogins.admin.agent.post(`${teenBase}/shopping-lists`, { name: 'Shop' });
    const listId = list.json().data.id;
    await withLogins.admin.agent.post(`${teenBase}/shopping-lists/${listId}/items`, { name: 'Crisps' });

    const response = await withLogins.agents.teen!.post(
      `${teenBase}/shopping-lists/${listId}/complete`,
      { amountMinor: 20000, recordExpense: true },
    );
    expect(response.statusCode).toBe(403);
  });

  it('cannot reach another household’s inventory or lists', async () => {
    const other = await seedHousehold(test);
    const theirItem = await other.admin.agent.post(
      `/api/v1/households/${other.householdId}/inventory`,
      { name: 'Their milk' },
    );
    const theirList = await other.admin.agent.post(
      `/api/v1/households/${other.householdId}/shopping-lists`,
      { name: 'Their list' },
    );

    expect((await home.admin.agent.get(`${inventoryUrl()}/${theirItem.json().data.id}`)).statusCode).toBe(404);
    expect((await home.admin.agent.get(`${listsUrl()}/${theirList.json().data.id}`)).statusCode).toBe(404);
    expect(
      (await home.admin.agent.post(`${listsUrl()}/${theirList.json().data.id}/complete`, {
        amountMinor: 1000,
      })).statusCode,
    ).toBe(404);
  });

  it('requires authentication', async () => {
    const anonymous = new Agent(test.app);
    expect((await anonymous.get(inventoryUrl())).statusCode).toBe(401);
    expect((await anonymous.get(listsUrl())).statusCode).toBe(401);
  });
});

describe('the dashboard suggestion', () => {
  it('coalesces low stock into one row rather than one per item', async () => {
    await addInventory({ name: 'Milk', quantity: 1, minQuantity: 2 });
    await addInventory({ name: 'Eggs', quantity: 0, minQuantity: 6, unit: 'piece' });
    await addInventory({ name: 'Sugar', quantity: 0, minQuantity: 1, unit: 'kg' });
    await addInventory({ name: 'Flour', quantity: 0, minQuantity: 1, unit: 'kg' });

    const dashboard = await home.admin.agent.get(`${base}/dashboard`);
    const all = [
      ...dashboard.json().data.needsAttention,
      ...dashboard.json().data.today,
      ...dashboard.json().data.thisWeek,
    ];
    const lowStockRows = all.filter((i: { entityType: string }) => i.entityType === 'inventory_item');

    // Four separate "X is low" lines would bury everything else.
    expect(lowStockRows).toHaveLength(1);
    expect(lowStockRows[0].title).toBe('4 items running low');
  });

  it('shows an open shopping list', async () => {
    await newList({ name: 'Weekly shop', store: 'Imtiaz' });
    const dashboard = await home.admin.agent.get(`${base}/dashboard`);
    const all = [...dashboard.json().data.today, ...dashboard.json().data.thisWeek];
    expect(all.some((i: { title: string }) => i.title === 'Weekly shop')).toBe(true);
  });
});
