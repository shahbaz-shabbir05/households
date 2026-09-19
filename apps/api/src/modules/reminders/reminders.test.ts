import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeTestApp,
  createTestApp,
  runJobOnce,
  shutdownTestDatabase,
  type TestApp,
} from '../../test/setup.js';
import { seedHousehold, type SeededHousehold } from '../../test/factories.js';

let test: TestApp;
let home: SeededHousehold;
let url: string;

const runJob = (name: string, at: Date) => runJobOnce(test, name, at);

beforeEach(async () => {
  test = await createTestApp();
  test.setNow(new Date('2026-03-10T06:00:00Z')); // 11:00 in Karachi
  home = await seedHousehold(test);
  url = `/api/v1/households/${home.householdId}/reminders`;
});
afterEach(async () => {
  await closeTestApp(test);
});
afterAll(async () => {
  await shutdownTestDatabase();
});

describe('creating reminders', () => {
  it('converts the typed date and time into an instant in household time', async () => {
    const response = await home.admin.agent.post(url, {
      title: 'Give Dada his medicine',
      remindOnDate: '2026-03-10',
      remindAtTime: '20:00',
    });

    expect(response.statusCode).toBe(201);
    // 20:00 in Karachi (UTC+5) is 15:00Z. The typed values are kept verbatim
    // so the UI never has to undo the conversion.
    expect(response.json().data).toMatchObject({
      remindOnDate: '2026-03-10',
      remindAtTime: '20:00',
      remindAt: '2026-03-10T15:00:00.000Z',
      status: 'pending',
    });
  });

  it('defaults the assignee to whoever set it', async () => {
    const response = await home.admin.agent.post(url, {
      title: 'Call the plumber',
      remindOnDate: '2026-03-11',
    });
    expect(response.json().data.assigneeMemberId).toBe(home.memberIds.admin);
  });

  it('can be linked to another entity', async () => {
    const task = await home.admin.agent.post(`/api/v1/households/${home.householdId}/tasks`, {
      title: 'Service the AC',
    });

    const response = await home.admin.agent.post(url, {
      title: 'Book the AC service',
      remindOnDate: '2026-03-12',
      entityType: 'task',
      entityId: task.json().data.id,
    });

    expect(response.json().data).toMatchObject({ entityType: 'task', entityId: task.json().data.id });
  });
});

describe('the reminder → notification pipeline', () => {
  it('turns a due reminder into a notification for its assignee', async () => {
    await home.admin.agent.post(url, {
      title: 'Pay the electricity bill',
      remindOnDate: '2026-03-10',
      remindAtTime: '11:00', // already due at the frozen clock
    });

    const dispatched = await runJob('dispatchReminders', new Date('2026-03-10T06:05:00Z'));
    expect(dispatched).toBe(1);

    const inbox = await home.admin.agent.get(
      `/api/v1/households/${home.householdId}/notifications`,
    );
    expect(inbox.json().data).toHaveLength(1);
    expect(inbox.json().data[0]).toMatchObject({
      type: 'reminder.due',
      title: 'Pay the electricity bill',
    });
  });

  it('does not fire a reminder before its time', async () => {
    await home.admin.agent.post(url, {
      title: 'Not due yet',
      remindOnDate: '2026-03-20',
      remindAtTime: '09:00',
    });

    expect(await runJob('dispatchReminders', new Date('2026-03-10T06:05:00Z'))).toBe(0);
  });

  it('does not duplicate when the dispatcher runs twice', async () => {
    await home.admin.agent.post(url, {
      title: 'Pay the electricity bill',
      remindOnDate: '2026-03-10',
      remindAtTime: '11:00',
    });

    await runJob('dispatchReminders', new Date('2026-03-10T06:05:00Z'));
    const second = await runJob('dispatchReminders', new Date('2026-03-10T06:10:00Z'));

    // The status transition means the second sweep finds nothing to do.
    expect(second).toBe(0);
    const inbox = await home.admin.agent.get(`/api/v1/households/${home.householdId}/notifications`);
    expect(inbox.json().data).toHaveLength(1);
  });

  it('defers a non-urgent notification raised during quiet hours', async () => {
    await home.admin.agent.patch(`/api/v1/households/${home.householdId}`, {
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    });

    // 02:00 Karachi = 21:00Z the previous day.
    test.setNow(new Date('2026-03-09T21:00:00Z'));
    await home.admin.agent.post(url, {
      title: 'Middle of the night',
      remindOnDate: '2026-03-10',
      remindAtTime: '02:00',
    });
    await runJob('dispatchReminders', new Date('2026-03-09T21:05:00Z'));

    const { notifications } = await import('../../db/schema/index.js');
    const rows = await test.container.db.select().from(notifications);
    expect(rows).toHaveLength(1);
    // Held until quiet hours end rather than waking the household at 2am.
    expect(rows[0]!.deferredUntil).not.toBeNull();

    const deliveries = await test.container.notifications.dispatchPending(test.container.db);
    expect(deliveries).toBe(0);
  });

  it('delivers an urgent notification even during quiet hours', async () => {
    test.setNow(new Date('2026-03-09T21:00:00Z'));
    await home.admin.agent.post(url, {
      title: 'Urgent',
      remindOnDate: '2026-03-10',
      remindAtTime: '02:00',
      priority: 'urgent',
    });
    await runJob('dispatchReminders', new Date('2026-03-09T21:05:00Z'));

    const { notifications } = await import('../../db/schema/index.js');
    const rows = await test.container.db.select().from(notifications);
    expect(rows[0]!.deferredUntil).toBeNull();
  });

  it('records a delivery attempt per channel', async () => {
    await home.admin.agent.post(url, {
      title: 'Pay the electricity bill',
      remindOnDate: '2026-03-10',
      remindAtTime: '11:00',
    });
    await runJob('dispatchReminders', new Date('2026-03-10T06:05:00Z'));
    await test.container.notifications.dispatchPending(test.container.db);

    const { notificationDeliveries } = await import('../../db/schema/index.js');
    const rows = await test.container.db.select().from(notificationDeliveries);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === 'sent' || r.status === 'skipped')).toBe(true);
  });
});

describe('snooze and dismiss', () => {
  it('snoozing reschedules and makes the reminder due again', async () => {
    const created = await home.admin.agent.post(url, {
      title: 'Snooze me',
      remindOnDate: '2026-03-10',
      remindAtTime: '11:00',
    });
    const id = created.json().data.id;
    await runJob('dispatchReminders', new Date('2026-03-10T06:05:00Z'));

    const snoozed = await home.admin.agent.post(`${url}/${id}/snooze`, { minutes: 60 });
    expect(snoozed.json().data.status).toBe('pending');
    expect(snoozed.json().data.remindAtTime).toBe('12:00'); // one hour later, Karachi time
  });

  it('dismissing stops it firing again', async () => {
    const created = await home.admin.agent.post(url, {
      title: 'Dismiss me',
      remindOnDate: '2026-03-10',
      remindAtTime: '11:00',
    });
    await home.admin.agent.post(`${url}/${created.json().data.id}/dismiss`, {});

    expect(await runJob('dispatchReminders', new Date('2026-03-10T06:05:00Z'))).toBe(0);
  });
});

describe('recurring reminders', () => {
  it('generates an occurrence per date, each with its own instant', async () => {
    await home.admin.agent.post(url, {
      title: 'Take the morning tablet',
      remindOnDate: '2026-03-10',
      remindAtTime: '08:00',
      recurrence: { freq: 'daily', interval: 1, count: 5 },
    });

    const list = await home.admin.agent.get(`${url}?perPage=50`);
    expect(list.json().meta.total).toBe(5);
    expect(list.json().data.map((r: { remindOnDate: string }) => r.remindOnDate)).toEqual([
      '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14',
    ]);
    // Each carries the same local time, converted independently.
    expect(list.json().data.every((r: { remindAtTime: string }) => r.remindAtTime === '08:00')).toBe(true);
  });
});

describe('authorization and isolation', () => {
  it('shows a teen only their own reminders', async () => {
    const withLogins = await seedHousehold(test, { withLogins: ['teen'] });
    const teenUrl = `/api/v1/households/${withLogins.householdId}/reminders`;

    await withLogins.admin.agent.post(teenUrl, { title: 'Admin only', remindOnDate: '2026-03-12' });
    await withLogins.admin.agent.post(teenUrl, {
      title: 'For the teen',
      remindOnDate: '2026-03-12',
      assigneeMemberId: withLogins.memberIds.teen,
    });

    const response = await withLogins.agents.teen!.get(teenUrl);
    expect(response.json().data.map((r: { title: string }) => r.title)).toEqual(['For the teen']);
  });

  it('cannot reach another household’s reminder', async () => {
    const other = await seedHousehold(test);
    const theirs = await other.admin.agent.post(
      `/api/v1/households/${other.householdId}/reminders`,
      { title: 'Theirs', remindOnDate: '2026-03-12' },
    );

    const id = theirs.json().data.id;
    expect((await home.admin.agent.patch(`${url}/${id}`, { title: 'x' })).statusCode).toBe(404);
    expect((await home.admin.agent.delete(`${url}/${id}`)).statusCode).toBe(404);
  });

  it('cannot mark someone else’s notification as read', async () => {
    const withLogins = await seedHousehold(test, { withLogins: ['adult'] });
    const otherUrl = `/api/v1/households/${withLogins.householdId}/reminders`;

    await withLogins.admin.agent.post(otherUrl, {
      title: 'Admin reminder',
      remindOnDate: '2026-03-10',
      remindAtTime: '11:00',
    });
    await runJob('dispatchReminders', new Date('2026-03-10T06:05:00Z'));

    const { notifications } = await import('../../db/schema/index.js');
    const rows = await test.container.db.select().from(notifications);
    const adminNotificationId = rows[0]!.id;

    const response = await withLogins.agents.adult!.post(
      `/api/v1/households/${withLogins.householdId}/notifications/read`,
      { notificationIds: [adminNotificationId] },
    );
    // Accepted, but nothing matched: the update is scoped to the caller.
    expect(response.json().data.updated).toBe(0);
  });
});
