import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Agent,
  closeTestApp,
  createTestApp,
  runJobOnce,
  shutdownTestDatabase,
  type TestApp,
} from '../../test/setup.js';
import { seedHousehold, type SeededHousehold } from '../../test/factories.js';

let test: TestApp;
let home: SeededHousehold;
let base: string;

const billsUrl = () => `${base}/bills`;

beforeEach(async () => {
  test = await createTestApp();
  test.setNow(new Date('2026-09-22T06:00:00Z')); // 11:00 in Karachi
  home = await seedHousehold(test);
  base = `/api/v1/households/${home.householdId}`;
});
afterEach(async () => {
  await closeTestApp(test);
});
afterAll(async () => {
  await shutdownTestDatabase();
});

const newBill = (over: Record<string, unknown> = {}) =>
  home.admin.agent.post(billsUrl(), {
    name: 'Electricity',
    billType: 'utility',
    providerName: 'K-Electric',
    utilityKind: 'electricity',
    accountNumber: 'KE-4471',
    dueDate: '2026-09-30',
    amountMinor: 1840000,
    ...over,
  });

describe('creating a bill', () => {
  it('records the obligation and defaults to the household currency', async () => {
    const response = await newBill();

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      name: 'Electricity',
      billType: 'utility',
      providerName: 'K-Electric',
      accountNumber: 'KE-4471',
      dueDate: '2026-09-30',
      amountMinor: 1840000,
      currency: 'PKR',
      status: 'upcoming',
      paidOn: null,
    });
  });

  it('reuses a provider rather than creating a second one', async () => {
    await newBill({ name: 'Electricity September' });
    await newBill({ name: 'Electricity October', dueDate: '2026-10-30' });

    const { providers } = await import('../../db/schema/index.js');
    const rows = await test.container.db.select().from(providers);
    // One "K-Electric", so the history stays in one place.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('K-Electric');
  });

  it('matches a provider regardless of case', async () => {
    await newBill({ providerName: 'K-Electric' });
    await newBill({ providerName: 'k-electric', name: 'Another', dueDate: '2026-10-30' });

    const { providers } = await import('../../db/schema/index.js');
    expect(await test.container.db.select().from(providers)).toHaveLength(1);
  });

  it('rejects a billing period that ends before it starts', async () => {
    const response = await newBill({ periodStart: '2026-09-01', periodEnd: '2026-08-01' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.details[0].path).toBe('periodEnd');
  });
});

describe('bill status', () => {
  it('is upcoming when the due date is beyond the reminder window', async () => {
    const response = await newBill({ dueDate: '2026-10-30', remindDaysBefore: 3 });
    expect(response.json().data.status).toBe('upcoming');
  });

  it('becomes due once inside the reminder window', async () => {
    // Today is 2026-09-22; three days ahead reaches the 25th.
    const response = await newBill({ dueDate: '2026-09-24', remindDaysBefore: 3 });
    expect(response.json().data.status).toBe('due');
  });

  it('is due on the day itself', async () => {
    expect((await newBill({ dueDate: '2026-09-22' })).json().data.status).toBe('due');
  });

  it('is overdue the day after, and says how late', async () => {
    const response = await newBill({ dueDate: '2026-09-19' });
    expect(response.json().data.status).toBe('overdue');
    expect(response.json().data.daysOverdue).toBe(3);
  });

  it('is evaluated in the household timezone, not the server’s', async () => {
    // At 12:00Z it is still the 22nd in Karachi (17:00) but already the 23rd
    // in Kiritimati (02:00). The same bill is therefore due in one household
    // and late in the other — which is the whole point of storing a timezone.
    test.setNow(new Date('2026-09-22T12:00:00Z'));

    const inKarachi = await newBill({ dueDate: '2026-09-22' });
    expect(inKarachi.json().data.status).toBe('due');

    await home.admin.agent.patch(base, { timezone: 'Pacific/Kiritimati' });
    const reread = await home.admin.agent.get(`${billsUrl()}/${inKarachi.json().data.id}`);
    expect(reread.json().data.status).toBe('overdue');
  });
});

describe('paying a bill', () => {
  it('records the payment and writes the linked expense in one step', async () => {
    const bill = await newBill();
    const billId = bill.json().data.id;

    const response = await home.admin.agent.post(`${billsUrl()}/${billId}/pay`, {
      paymentMethod: 'jazzcash',
    });

    expect(response.statusCode).toBe(200);
    const result = response.json().data;
    expect(result.bill).toMatchObject({
      status: 'paid',
      paidOn: '2026-09-22',
      paidAmountMinor: 1840000,
      paymentMethod: 'jazzcash',
    });

    // The ledger entry exists, is attributed, and carries the provider.
    expect(result.expense).toMatchObject({
      amountMinor: 1840000,
      category: 'utilities',
      paymentMethod: 'jazzcash',
      merchant: 'K-Electric',
      description: 'Bill: Electricity',
    });

    const expenses = await home.admin.agent.get(`${base}/expenses`);
    expect(expenses.json().data).toHaveLength(1);
    expect(result.bill.expenseId).toBe(expenses.json().data[0].id);
  });

  it('accepts a different amount from the one billed', async () => {
    const bill = await newBill();
    const response = await home.admin.agent.post(
      `${billsUrl()}/${bill.json().data.id}/pay`,
      { amountMinor: 1750000 },
    );

    expect(response.json().data.bill.paidAmountMinor).toBe(1750000);
    expect(response.json().data.expense.amountMinor).toBe(1750000);
  });

  it('can mark a bill paid without touching the ledger', async () => {
    const bill = await newBill();
    const response = await home.admin.agent.post(
      `${billsUrl()}/${bill.json().data.id}/pay`,
      { recordExpense: false },
    );

    expect(response.json().data.bill.status).toBe('paid');
    expect(response.json().data.expense).toBeNull();
    expect((await home.admin.agent.get(`${base}/expenses`)).json().data).toHaveLength(0);
  });

  it('closes any reminder that was nagging about it', async () => {
    const bill = await newBill();
    const billId = bill.json().data.id;

    await home.admin.agent.post(`${base}/reminders`, {
      title: 'Pay the electricity bill',
      remindOnDate: '2026-09-28',
      entityType: 'bill',
      entityId: billId,
    });

    const response = await home.admin.agent.post(`${billsUrl()}/${billId}/pay`, {});
    expect(response.json().data.remindersResolved).toBe(1);

    const pending = await home.admin.agent.get(`${base}/reminders?status=pending`);
    expect(pending.json().data).toHaveLength(0);
  });

  it('refuses to pay the same bill twice', async () => {
    const bill = await newBill();
    const billId = bill.json().data.id;

    await home.admin.agent.post(`${billsUrl()}/${billId}/pay`, {});
    const second = await home.admin.agent.post(`${billsUrl()}/${billId}/pay`, {});

    // Otherwise the spend is counted twice.
    expect(second.statusCode).toBe(409);
    expect((await home.admin.agent.get(`${base}/expenses`)).json().data).toHaveLength(1);
  });

  /**
   * The atomicity guarantee. A paid bill with no ledger entry is exactly the
   * inconsistency this endpoint exists to prevent.
   */
  it('rolls back the payment when the ledger write fails', async () => {
    const bill = await newBill();
    const billId = bill.json().data.id;

    const original = test.container.expenses.createWithin.bind(test.container.expenses);
    test.container.expenses.createWithin = async () => {
      throw new Error('simulated ledger failure');
    };

    const response = await home.admin.agent.post(`${billsUrl()}/${billId}/pay`, {});
    test.container.expenses.createWithin = original;

    expect(response.statusCode).toBe(500);

    const reread = await home.admin.agent.get(`${billsUrl()}/${billId}`);
    expect(reread.json().data).toMatchObject({ status: 'upcoming', paidOn: null, expenseId: null });
    expect((await home.admin.agent.get(`${base}/expenses`)).json().data).toHaveLength(0);

    // And it is still payable once the fault clears.
    expect((await home.admin.agent.post(`${billsUrl()}/${billId}/pay`, {})).statusCode).toBe(200);
  });

  it('undoes a payment and removes the expense it created', async () => {
    const bill = await newBill();
    const billId = bill.json().data.id;
    await home.admin.agent.post(`${billsUrl()}/${billId}/pay`, {});

    const response = await home.admin.agent.post(`${billsUrl()}/${billId}/unpay`, {});
    expect(response.json().data).toMatchObject({ status: 'upcoming', paidOn: null });

    // Otherwise the month's total keeps counting a payment that was undone.
    expect((await home.admin.agent.get(`${base}/expenses`)).json().data).toHaveLength(0);
    const summary = await home.admin.agent.get(`${base}/expenses/summary?month=2026-09`);
    expect(summary.json().data.totalMinor).toBe(0);
  });
});

describe('recurring bills', () => {
  it('generates the months ahead so rent is visible before it is due', async () => {
    await newBill({
      name: 'Rent',
      billType: 'rent',
      expenseCategory: 'rent',
      dueDate: '2026-10-01',
      amountMinor: 8000000,
      recurrence: { freq: 'monthly', interval: 1 },
    });

    const list = await home.admin.agent.get(`${billsUrl()}?perPage=50&sort=dueDate&order=asc`);
    const dates = list.json().data.map((b: { dueDate: string }) => b.dueDate);
    expect(dates[0]).toBe('2026-10-01');
    expect(dates.length).toBeGreaterThan(2);
  });

  it('clamps a month-end due date instead of skipping February', async () => {
    await newBill({
      name: 'Rent',
      dueDate: '2026-12-31',
      recurrence: { freq: 'monthly', interval: 1 },
    });

    const list = await home.admin.agent.get(`${billsUrl()}?perPage=50&sort=dueDate&order=asc`);
    const dates = list.json().data.map((b: { dueDate: string }) => b.dueDate);
    expect(dates).toContain('2027-02-28');
  });

  it('paying one month does not touch the next', async () => {
    await newBill({ name: 'Rent', dueDate: '2026-10-01', recurrence: { freq: 'monthly', interval: 1 } });
    const list = await home.admin.agent.get(`${billsUrl()}?perPage=50&sort=dueDate&order=asc`);
    const [first, second] = list.json().data;

    await home.admin.agent.post(`${billsUrl()}/${first.id}/pay`, {});

    expect((await home.admin.agent.get(`${billsUrl()}/${first.id}`)).json().data.status).toBe('paid');
    expect((await home.admin.agent.get(`${billsUrl()}/${second.id}`)).json().data.paidOn).toBeNull();
  });
});

describe('the subscriptions view', () => {
  it('is a filter over bills, not a separate thing', async () => {
    await newBill({ name: 'Netflix', billType: 'subscription', expenseCategory: 'subscriptions' });
    await newBill({ name: 'Electricity', billType: 'utility' });

    const subscriptions = await home.admin.agent.get(`${billsUrl()}?billType=subscription`);
    expect(subscriptions.json().data.map((b: { name: string }) => b.name)).toEqual(['Netflix']);
  });
});

describe('listing', () => {
  it('reports everything still owed, not just this page', async () => {
    await newBill({ name: 'A', amountMinor: 100000 });
    await newBill({ name: 'B', amountMinor: 250000, dueDate: '2026-10-05' });
    const paid = await newBill({ name: 'C', amountMinor: 900000, dueDate: '2026-10-10' });
    await home.admin.agent.post(`${billsUrl()}/${paid.json().data.id}/pay`, {});

    const response = await home.admin.agent.get(`${billsUrl()}?perPage=1`);
    expect(response.json().data).toHaveLength(1);
    // The paid one is excluded from what is outstanding.
    expect(response.json().totals.outstandingAmountMinor).toBe(350000);
  });

  it('filters to unpaid', async () => {
    await newBill({ name: 'A' });
    const paid = await newBill({ name: 'B', dueDate: '2026-10-05' });
    await home.admin.agent.post(`${billsUrl()}/${paid.json().data.id}/pay`, {});

    const unpaid = await home.admin.agent.get(`${billsUrl()}?unpaid=true`);
    expect(unpaid.json().data.map((b: { name: string }) => b.name)).toEqual(['A']);
  });
});

describe('due and overdue notices', () => {
  it('tells the adults about a bill that has fallen due', async () => {
    await newBill({ dueDate: '2026-09-24', remindDaysBefore: 3 });

    const touched = await runJobOnce(test, 'refreshBillStatuses', new Date('2026-09-22T07:00:00Z'));
    expect(touched).toBeGreaterThan(0);

    const inbox = await home.admin.agent.get(`${base}/notifications`);
    expect(inbox.json().data[0]).toMatchObject({ type: 'bill.due_soon' });
  });

  it('does not nag again the same day', async () => {
    await newBill({ dueDate: '2026-09-24' });
    await runJobOnce(test, 'refreshBillStatuses', new Date('2026-09-22T07:00:00Z'));
    await runJobOnce(test, 'refreshBillStatuses', new Date('2026-09-22T08:00:00Z'));

    const inbox = await home.admin.agent.get(`${base}/notifications`);
    // An overdue bill nagging ninety-six times a day would get the app muted.
    expect(inbox.json().data).toHaveLength(1);
  });

  it('still raises an overdue notice after a due-soon one', async () => {
    await newBill({ dueDate: '2026-09-23', remindDaysBefore: 3 });
    await runJobOnce(test, 'refreshBillStatuses', new Date('2026-09-22T07:00:00Z'));
    await runJobOnce(test, 'refreshBillStatuses', new Date('2026-09-25T07:00:00Z'));

    const inbox = await home.admin.agent.get(`${base}/notifications`);
    const types = inbox.json().data.map((n: { type: string }) => n.type).sort();
    expect(types).toEqual(['bill.due_soon', 'bill.overdue']);
  });

  it('says nothing about a bill that is already paid', async () => {
    const bill = await newBill({ dueDate: '2026-09-24' });
    await home.admin.agent.post(`${billsUrl()}/${bill.json().data.id}/pay`, {});

    await runJobOnce(test, 'refreshBillStatuses', new Date('2026-09-22T07:00:00Z'));
    expect((await home.admin.agent.get(`${base}/notifications`)).json().data).toHaveLength(0);
  });
});

describe('the dashboard', () => {
  it('puts an overdue bill in needs-attention with its amount', async () => {
    await newBill({ dueDate: '2026-09-15', amountMinor: 1840000 });

    const dashboard = await home.admin.agent.get(`${base}/dashboard`);
    const item = dashboard.json().data.needsAttention.find(
      (i: { entityType: string }) => i.entityType === 'bill',
    );
    expect(item).toMatchObject({ title: 'Electricity', isOverdue: true, amountMinor: 1840000 });
  });
});

describe('authorization and isolation', () => {
  it('hides bills from teens and children entirely', async () => {
    const withLogins = await seedHousehold(test, { withLogins: ['teen', 'child'] });
    const theirUrl = `/api/v1/households/${withLogins.householdId}/bills`;

    for (const role of ['teen', 'child'] as const) {
      expect((await withLogins.agents[role]!.get(theirUrl)).statusCode).toBe(403);
    }
  });

  it('cannot reach another household’s bill', async () => {
    const other = await seedHousehold(test);
    const theirs = await other.admin.agent.post(
      `/api/v1/households/${other.householdId}/bills`,
      { name: 'Theirs', dueDate: '2026-10-01', amountMinor: 1000 },
    );
    const id = theirs.json().data.id;

    expect((await home.admin.agent.get(`${billsUrl()}/${id}`)).statusCode).toBe(404);
    expect((await home.admin.agent.post(`${billsUrl()}/${id}/pay`, {})).statusCode).toBe(404);
    expect((await home.admin.agent.delete(`${billsUrl()}/${id}`)).statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    expect((await new Agent(test.app).get(billsUrl())).statusCode).toBe(401);
  });
});
