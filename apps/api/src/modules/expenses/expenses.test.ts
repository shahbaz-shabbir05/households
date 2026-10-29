import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Agent, closeTestApp, createTestApp, shutdownTestDatabase, type TestApp } from '../../test/setup.js';
import { seedHousehold, type SeededHousehold } from '../../test/factories.js';

let test: TestApp;
let home: SeededHousehold;
let url: string;

beforeEach(async () => {
  test = await createTestApp();
  test.setNow(new Date('2026-03-10T06:00:00Z'));
  home = await seedHousehold(test);
  url = `/api/v1/households/${home.householdId}/expenses`;
});
afterEach(async () => {
  await closeTestApp(test);
});
afterAll(async () => {
  await shutdownTestDatabase();
});

const spend = (over: Record<string, unknown> = {}) =>
  home.admin.agent.post(url, {
    amountMinor: 100000,
    spentOn: '2026-03-10',
    category: 'groceries',
    paymentMethod: 'cash',
    ...over,
  });

describe('recording a spend', () => {
  it('defaults the currency to the household’s', async () => {
    const response = await spend();
    expect(response.statusCode).toBe(201);
    expect(response.json().data.currency).toBe('PKR');
  });

  it('attributes an unassigned expense to whoever recorded it', async () => {
    const response = await spend();
    expect(response.json().data.paidByMemberId).toBe(home.memberIds.admin);
  });

  it('keeps money as integer minor units on the wire', async () => {
    const response = await spend({ amountMinor: 487550 });
    expect(response.json().data.amountMinor).toBe(487550);
    expect(Number.isInteger(response.json().data.amountMinor)).toBe(true);
  });

  it('rejects a fractional amount rather than rounding it silently', async () => {
    const response = await spend({ amountMinor: 1250.5 });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.details[0].path).toBe('amountMinor');
  });

  it('rejects a negative amount', async () => {
    expect((await spend({ amountMinor: -500 })).statusCode).toBe(400);
  });

  it('rejects a payer from another household', async () => {
    const other = await seedHousehold(test);
    const response = await spend({ paidByMemberId: other.memberIds.adult });
    expect(response.statusCode).toBe(400);
  });

  it('accepts the locally common payment methods', async () => {
    for (const method of ['cash', 'easypaisa', 'jazzcash', 'bank_transfer', 'credit_card']) {
      const response = await spend({ paymentMethod: method });
      expect(response.statusCode).toBe(201);
      expect(response.json().data.paymentMethod).toBe(method);
    }
  });
});

describe('listing and filtering', () => {
  beforeEach(async () => {
    await spend({ amountMinor: 100000, category: 'groceries', spentOn: '2026-03-01', merchant: 'Imtiaz' });
    await spend({ amountMinor: 250000, category: 'utilities', spentOn: '2026-03-05' });
    await spend({ amountMinor: 50000, category: 'groceries', spentOn: '2026-02-20' });
  });

  it('filters by category and date window', async () => {
    const groceries = await home.admin.agent.get(`${url}?category=groceries`);
    expect(groceries.json().meta.total).toBe(2);

    const march = await home.admin.agent.get(`${url}?from=2026-03-01&to=2026-03-31`);
    expect(march.json().meta.total).toBe(2);
  });

  it('returns the total for everything matching, not just this page', async () => {
    // The number a user actually wants when they filter.
    const response = await home.admin.agent.get(`${url}?category=groceries&perPage=1`);
    expect(response.json().data).toHaveLength(1);
    expect(response.json().totals.filteredAmountMinor).toBe(150000);
    expect(response.json().totals.currency).toBe('PKR');
  });

  it('searches the merchant without treating input as a wildcard', async () => {
    const found = await home.admin.agent.get(`${url}?search=Imtiaz`);
    expect(found.json().meta.total).toBe(1);

    const wildcard = await home.admin.agent.get(`${url}?search=%25`);
    expect(wildcard.json().meta.total).toBe(0);
  });

  it('sorts newest first by default', async () => {
    const response = await home.admin.agent.get(url);
    const dates = response.json().data.map((e: { spentOn: string }) => e.spentOn);
    expect(dates).toEqual(['2026-03-05', '2026-03-01', '2026-02-20']);
  });
});

describe('the monthly summary', () => {
  it('totals the month and compares it with the one before', async () => {
    await spend({ amountMinor: 300000, spentOn: '2026-02-15', category: 'groceries' });
    await spend({ amountMinor: 100000, spentOn: '2026-03-02', category: 'groceries' });
    await spend({ amountMinor: 200000, spentOn: '2026-03-08', category: 'utilities' });

    const response = await home.admin.agent.get(`${url}/summary?month=2026-03`);
    const summary = response.json().data;

    expect(summary.totalMinor).toBe(300000);
    expect(summary.previousMonthMinor).toBe(300000);
    expect(summary.changePercent).toBe(0);
    expect(summary.expenseCount).toBe(2);
  });

  it('breaks the month down by category, largest first', async () => {
    await spend({ amountMinor: 100000, spentOn: '2026-03-02', category: 'groceries' });
    await spend({ amountMinor: 500000, spentOn: '2026-03-03', category: 'rent' });
    await spend({ amountMinor: 50000, spentOn: '2026-03-04', category: 'groceries' });

    const summary = (await home.admin.agent.get(`${url}/summary?month=2026-03`)).json().data;
    expect(summary.byCategory[0]).toMatchObject({ category: 'rent', amountMinor: 500000, count: 1 });
    expect(summary.byCategory[1]).toMatchObject({ category: 'groceries', amountMinor: 150000, count: 2 });
  });

  it('reports no change rather than an invented percentage from zero', async () => {
    await spend({ amountMinor: 100000, spentOn: '2026-03-02' });

    const summary = (await home.admin.agent.get(`${url}/summary?month=2026-03`)).json().data;
    expect(summary.previousMonthMinor).toBe(0);
    // A jump from nothing is not a percentage increase.
    expect(summary.changePercent).toBeNull();
  });

  it('defaults to the current month in household time', async () => {
    await spend({ amountMinor: 100000, spentOn: '2026-03-10' });
    const summary = (await home.admin.agent.get(`${url}/summary`)).json().data;
    expect(summary.month).toBe('2026-03');
    expect(summary.totalMinor).toBe(100000);
  });

  it('excludes deleted expenses from the totals', async () => {
    const kept = await spend({ amountMinor: 100000, spentOn: '2026-03-02' });
    const removed = await spend({ amountMinor: 900000, spentOn: '2026-03-03' });
    await home.admin.agent.delete(`${url}/${removed.json().data.id}`);

    const summary = (await home.admin.agent.get(`${url}/summary?month=2026-03`)).json().data;
    expect(summary.totalMinor).toBe(100000);
    expect(kept.statusCode).toBe(201);
  });
});

describe('authorization and isolation', () => {
  it('hides the ledger from teens and children entirely', async () => {
    const withLogins = await seedHousehold(test, { withLogins: ['teen', 'child'] });
    const theirUrl = `/api/v1/households/${withLogins.householdId}/expenses`;

    for (const role of ['teen', 'child'] as const) {
      expect((await withLogins.agents[role]!.get(theirUrl)).statusCode).toBe(403);
      expect((await withLogins.agents[role]!.get(`${theirUrl}/summary`)).statusCode).toBe(403);
      expect(
        (await withLogins.agents[role]!.post(theirUrl, { amountMinor: 100, spentOn: '2026-03-10' }))
          .statusCode,
      ).toBe(403);
    }
  });

  it('lets an adult manage the ledger', async () => {
    const withLogins = await seedHousehold(test, { withLogins: ['adult'] });
    const theirUrl = `/api/v1/households/${withLogins.householdId}/expenses`;

    const created = await withLogins.agents.adult!.post(theirUrl, {
      amountMinor: 100000,
      spentOn: '2026-03-10',
    });
    expect(created.statusCode).toBe(201);
    expect((await withLogins.agents.adult!.get(theirUrl)).statusCode).toBe(200);
  });

  it('cannot reach another household’s expenses', async () => {
    const other = await seedHousehold(test);
    const theirs = await other.admin.agent.post(
      `/api/v1/households/${other.householdId}/expenses`,
      { amountMinor: 100000, spentOn: '2026-03-10' },
    );
    const id = theirs.json().data.id;

    expect((await home.admin.agent.get(`${url}/${id}`)).statusCode).toBe(404);
    expect((await home.admin.agent.patch(`${url}/${id}`, { amountMinor: 1 })).statusCode).toBe(404);
    expect((await home.admin.agent.delete(`${url}/${id}`)).statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    expect((await new Agent(test.app).get(url)).statusCode).toBe(401);
  });
});

describe('deletion and audit', () => {
  it('soft-deletes so last month’s totals do not silently change', async () => {
    const created = await spend();
    const id = created.json().data.id;

    expect((await home.admin.agent.delete(`${url}/${id}`)).statusCode).toBe(204);
    expect((await home.admin.agent.get(`${url}/${id}`)).statusCode).toBe(404);

    const { expenses } = await import('../../db/schema/index.js');
    const { eq } = await import('drizzle-orm');
    const rows = await test.container.db.select().from(expenses).where(eq(expenses.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deletedAt).not.toBeNull();
  });

  it('writes an audit entry for every mutation', async () => {
    const created = await spend();
    const id = created.json().data.id;
    await home.admin.agent.patch(`${url}/${id}`, { amountMinor: 200000 });
    await home.admin.agent.delete(`${url}/${id}`);

    const { auditLogs } = await import('../../db/schema/index.js');
    const { and, eq } = await import('drizzle-orm');
    const rows = await test.container.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'expense'), eq(auditLogs.entityId, id)));

    expect(rows.map((r) => r.action).sort()).toEqual(['create', 'delete', 'update']);
  });
});
