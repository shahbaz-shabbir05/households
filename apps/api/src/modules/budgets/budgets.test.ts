import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTestApp, createTestApp, shutdownTestDatabase, type TestApp } from '../../test/setup.js';
import { seedHousehold, type SeededHousehold } from '../../test/factories.js';

let test: TestApp;
let home: SeededHousehold;
let base: string;

beforeEach(async () => {
  test = await createTestApp();
  test.setNow(new Date('2026-09-22T06:00:00Z'));
  home = await seedHousehold(test);
  base = `/api/v1/households/${home.householdId}`;
});
afterEach(async () => {
  await closeTestApp(test);
});
afterAll(async () => {
  await shutdownTestDatabase();
});

const budget = (over: Record<string, unknown> = {}) =>
  home.admin.agent.post(`${base}/budgets`, { category: 'groceries', amountMinor: 5000000, ...over });

const spend = (over: Record<string, unknown> = {}) =>
  home.admin.agent.post(`${base}/expenses`, {
    amountMinor: 100000,
    spentOn: '2026-09-10',
    category: 'groceries',
    ...over,
  });

describe('setting a budget', () => {
  it('creates a monthly limit for a category', async () => {
    const response = await budget();
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      category: 'groceries',
      amountMinor: 5000000,
      currency: 'PKR',
      warnAtPercent: 80,
    });
  });

  it('creates an overall household limit when no category is given', async () => {
    const response = await home.admin.agent.post(`${base}/budgets`, { amountMinor: 20000000 });
    expect(response.json().data.category).toBeNull();
  });

  it('refuses a second live budget for the same category', async () => {
    await budget();
    const duplicate = await budget();
    // Two limits for one category makes "am I over?" ambiguous.
    expect(duplicate.statusCode).toBe(409);
  });

  it('allows an overall budget alongside a category one', async () => {
    await budget({ category: 'groceries' });
    const overall = await home.admin.agent.post(`${base}/budgets`, { amountMinor: 20000000 });
    expect(overall.statusCode).toBe(201);
  });

  it('refuses a budget of nothing', async () => {
    expect((await budget({ amountMinor: 0 })).statusCode).toBe(400);
  });
});

describe('how a budget is doing', () => {
  it('is under when spending is below the warning point', async () => {
    await budget({ amountMinor: 5000000, warnAtPercent: 80 });
    await spend({ amountMinor: 1000000 });

    const status = (await home.admin.agent.get(`${base}/budgets/status`)).json().data;
    expect(status[0]).toMatchObject({
      category: 'groceries',
      spentMinor: 1000000,
      remainingMinor: 4000000,
      usedPercent: 20,
      state: 'under',
    });
  });

  it('is approaching once it crosses the warning point', async () => {
    await budget({ amountMinor: 5000000, warnAtPercent: 80 });
    await spend({ amountMinor: 4200000 });

    const status = (await home.admin.agent.get(`${base}/budgets/status`)).json().data;
    expect(status[0].state).toBe('approaching');
  });

  it('is over once the limit is crossed, and reports a negative remainder', async () => {
    await budget({ amountMinor: 5000000 });
    await spend({ amountMinor: 6000000 });

    const status = (await home.admin.agent.get(`${base}/budgets/status`)).json().data;
    expect(status[0].state).toBe('over');
    // The honest number, not a floor at zero.
    expect(status[0].remainingMinor).toBe(-1000000);
    expect(status[0].usedPercent).toBe(120);
  });

  it('counts only its own category', async () => {
    await budget({ category: 'groceries', amountMinor: 5000000 });
    await spend({ amountMinor: 1000000, category: 'groceries' });
    await spend({ amountMinor: 9000000, category: 'rent' });

    const status = (await home.admin.agent.get(`${base}/budgets/status`)).json().data;
    expect(status[0].spentMinor).toBe(1000000);
  });

  it('counts everything against the overall limit', async () => {
    await home.admin.agent.post(`${base}/budgets`, { amountMinor: 20000000 });
    await spend({ amountMinor: 1000000, category: 'groceries' });
    await spend({ amountMinor: 9000000, category: 'rent' });

    const status = (await home.admin.agent.get(`${base}/budgets/status`)).json().data;
    expect(status[0].spentMinor).toBe(10000000);
  });

  it('ignores spending from other months', async () => {
    await budget({ amountMinor: 5000000 });
    await spend({ amountMinor: 1000000, spentOn: '2026-09-10' });
    await spend({ amountMinor: 4000000, spentOn: '2026-08-10' });

    const status = (await home.admin.agent.get(`${base}/budgets/status?month=2026-09`)).json().data;
    expect(status[0].spentMinor).toBe(1000000);
  });

  it('ignores deleted expenses', async () => {
    await budget({ amountMinor: 5000000 });
    const kept = await spend({ amountMinor: 1000000 });
    const removed = await spend({ amountMinor: 4000000 });
    await home.admin.agent.delete(`${base}/expenses/${removed.json().data.id}`);

    const status = (await home.admin.agent.get(`${base}/budgets/status`)).json().data;
    expect(status[0].spentMinor).toBe(1000000);
    expect(kept.statusCode).toBe(201);
  });

  it('returns nothing when no budget is set, rather than a zero', async () => {
    await spend();
    const status = (await home.admin.agent.get(`${base}/budgets/status`)).json().data;
    expect(status).toEqual([]);
  });
});

describe('paying a bill counts against the budget', () => {
  it('flows through the expense the payment creates', async () => {
    // The composition that makes budgets worth having: nobody types the
    // utilities spend, it arrives because a bill was paid.
    await home.admin.agent.post(`${base}/budgets`, { category: 'utilities', amountMinor: 2000000 });

    const bill = await home.admin.agent.post(`${base}/bills`, {
      name: 'Electricity',
      dueDate: '2026-09-30',
      amountMinor: 1840000,
    });
    await home.admin.agent.post(`${base}/bills/${bill.json().data.id}/pay`, {});

    const status = (await home.admin.agent.get(`${base}/budgets/status`)).json().data;
    expect(status[0]).toMatchObject({ category: 'utilities', spentMinor: 1840000, state: 'approaching' });
  });
});

describe('ending a budget', () => {
  it('stops it applying to later months and frees the category', async () => {
    const created = await budget({ startsOn: '2026-01-01' });
    const ended = await home.admin.agent.patch(`${base}/budgets/${created.json().data.id}`, {
      endsOn: '2026-08-31',
    });
    expect(ended.statusCode).toBe(200);

    const september = (
      await home.admin.agent.get(`${base}/budgets/status?month=2026-09`)
    ).json().data;
    expect(september).toEqual([]);

    // It still applies to the months it covered.
    const august = (await home.admin.agent.get(`${base}/budgets/status?month=2026-08`)).json().data;
    expect(august).toHaveLength(1);

    // And a fresh budget for the same category is now allowed.
    expect((await budget()).statusCode).toBe(201);
  });

  it('refuses to end a budget before it started, and says which field', async () => {
    const created = await budget({ startsOn: '2026-09-01' });
    const response = await home.admin.agent.patch(`${base}/budgets/${created.json().data.id}`, {
      endsOn: '2026-08-31',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details[0].path).toBe('endsOn');
  });
});

describe('authorization and isolation', () => {
  it('hides budgets from teens', async () => {
    const withLogins = await seedHousehold(test, { withLogins: ['teen'] });
    const theirBase = `/api/v1/households/${withLogins.householdId}/budgets`;

    expect((await withLogins.agents.teen!.get(theirBase)).statusCode).toBe(403);
    expect((await withLogins.agents.teen!.get(`${theirBase}/status`)).statusCode).toBe(403);
  });

  it('cannot reach another household’s budget', async () => {
    const other = await seedHousehold(test);
    const theirs = await other.admin.agent.post(
      `/api/v1/households/${other.householdId}/budgets`,
      { amountMinor: 1000000 },
    );
    const id = theirs.json().data.id;

    expect(
      (await home.admin.agent.patch(`${base}/budgets/${id}`, { amountMinor: 1 })).statusCode,
    ).toBe(404);
    expect((await home.admin.agent.delete(`${base}/budgets/${id}`)).statusCode).toBe(404);
  });
});
