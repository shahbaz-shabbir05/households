import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTestApp, createTestApp, shutdownTestDatabase, type TestApp } from '../../test/setup.js';
import { seedHousehold } from '../../test/factories.js';
import type { DashboardContributor } from './types.js';

let test: TestApp;

beforeEach(async () => {
  test = await createTestApp();
});
afterEach(async () => {
  await closeTestApp(test);
});
afterAll(async () => {
  await shutdownTestDatabase();
});

const stubContributor = (
  name: string,
  items: Array<Partial<Parameters<DashboardContributor['collect']>> | unknown>,
): DashboardContributor => ({
  name,
  collect: async () => items as never,
});

describe('GET /dashboard', () => {
  it('returns an honest empty snapshot for a brand-new household', async () => {
    const { householdId, admin } = await seedHousehold(test);

    const response = await admin.agent.get(`/api/v1/households/${householdId}/dashboard`);
    expect(response.statusCode).toBe(200);

    const data = response.json().data;
    expect(data.needsAttention).toEqual([]);
    expect(data.today).toEqual([]);
    expect(data.counts).toMatchObject({ needsAttention: 0, today: 0, thisWeek: 0 });
    expect(data.household.memberCount).toBe(5);
  });

  it('computes today and the week in the household timezone, not the server’s', async () => {
    const { householdId, admin } = await seedHousehold(test);
    await admin.agent.patch(`/api/v1/households/${householdId}`, { timezone: 'Pacific/Kiritimati' });

    // 2026-03-01T12:00Z is already 2026-03-02 in UTC+14.
    test.setNow(new Date('2026-03-01T12:00:00Z'));

    const response = await admin.agent.get(`/api/v1/households/${householdId}/dashboard`);
    expect(response.json().data.window.today).toBe('2026-03-02');
  });

  it('ranks overdue items first, then urgency, then time', async () => {
    const { householdId, admin } = await seedHousehold(test);
    test.setNow(new Date('2026-03-10T06:00:00Z'));

    test.container.dashboard.register(
      stubContributor('stub', [
        { id: '1', entityType: 'task', title: 'Normal today', date: '2026-03-10', time: '18:00', priority: 'normal', isOverdue: false },
        { id: '2', entityType: 'bill', title: 'Overdue bill', date: '2026-03-01', priority: 'normal', isOverdue: true },
        { id: '3', entityType: 'task', title: 'Urgent today', date: '2026-03-10', time: '09:00', priority: 'urgent', isOverdue: false },
        { id: '4', entityType: 'event', title: 'Later this week', date: '2026-03-13', priority: 'normal', isOverdue: false },
      ]),
    );

    const response = await admin.agent.get(`/api/v1/households/${householdId}/dashboard`);
    const data = response.json().data;

    // Overdue and urgent both demand attention; overdue outranks urgent.
    expect(data.needsAttention.map((i: { id: string }) => i.id)).toEqual(['2', '3']);
    expect(data.today.map((i: { id: string }) => i.id)).toEqual(['1']);
    expect(data.thisWeek.map((i: { id: string }) => i.id)).toEqual(['4']);
  });

  it('offers only the quick actions the member is allowed to use', async () => {
    const { householdId, agents } = await seedHousehold(test, { withLogins: ['teen'] });

    const teenView = await agents.teen!.get(`/api/v1/households/${householdId}/dashboard`);
    const teenActions = teenView.json().data.quickActions;

    // A teen may add a task or a grocery item, but not an expense or a bill.
    expect(teenActions).toContain('task');
    expect(teenActions).toContain('grocery');
    expect(teenActions).not.toContain('expense');
    expect(teenActions).not.toContain('bill');
  });

  it('degrades one section rather than failing the whole dashboard', async () => {
    const { householdId, admin } = await seedHousehold(test);

    test.container.dashboard.register({
      name: 'broken',
      collect: async () => {
        throw new Error('module exploded');
      },
    });
    test.setNow(new Date('2026-03-10T06:00:00Z'));
    test.container.dashboard.register(
      stubContributor('healthy', [
        { id: 'ok', entityType: 'task', title: 'Still here', date: '2026-03-10', priority: 'normal', isOverdue: false },
      ]),
    );

    const response = await admin.agent.get(`/api/v1/households/${householdId}/dashboard`);
    // The healthy contributor's item still arrives; only the broken section is lost.
    expect(response.statusCode).toBe(200);
    expect(response.json().data.today.map((i: { id: string }) => i.id)).toEqual(['ok']);
  });

  it('is not reachable for another household', async () => {
    const a = await seedHousehold(test);
    const b = await seedHousehold(test);

    const response = await a.admin.agent.get(`/api/v1/households/${b.householdId}/dashboard`);
    expect(response.statusCode).toBe(404);
  });
});
