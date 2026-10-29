import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTestApp, createTestApp, shutdownTestDatabase, type TestApp } from '../../test/setup.js';
import { seedHousehold, type SeededHousehold } from '../../test/factories.js';

let test: TestApp;
let home: SeededHousehold;
let url: string;

beforeEach(async () => {
  test = await createTestApp();
  test.setNow(new Date('2026-03-10T06:00:00Z'));
  home = await seedHousehold(test);
  url = `/api/v1/households/${home.householdId}/events`;
});
afterEach(async () => {
  await closeTestApp(test);
});
afterAll(async () => {
  await shutdownTestDatabase();
});

describe('creating events', () => {
  it('treats an event with no time as all-day', async () => {
    const response = await home.admin.agent.post(url, {
      title: 'Zara’s birthday',
      eventType: 'birthday',
      startDate: '2026-04-18',
      participantMemberIds: [home.memberIds.teen],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      title: 'Zara’s birthday',
      startDate: '2026-04-18',
      startTime: null,
      isAllDay: true,
    });
    expect(response.json().data.participantMemberIds).toEqual([home.memberIds.teen]);
  });

  it('keeps a date-only event on its date regardless of timezone', async () => {
    // A birthday is a calendar date, not an instant. Storing it as a timestamp
    // is how it ends up a day early for half the family (docs/04).
    await home.admin.agent.patch(`/api/v1/households/${home.householdId}`, {
      timezone: 'Pacific/Kiritimati',
    });

    const created = await home.admin.agent.post(url, {
      title: 'Anniversary',
      eventType: 'anniversary',
      startDate: '2026-04-18',
    });
    expect(created.json().data.startDate).toBe('2026-04-18');

    const reread = await home.admin.agent.get(`${url}/${created.json().data.id}`);
    expect(reread.json().data.startDate).toBe('2026-04-18');
  });

  it('records a timed event as not all-day', async () => {
    const response = await home.admin.agent.post(url, {
      title: 'Parent–teacher meeting',
      eventType: 'school',
      startDate: '2026-03-20',
      startTime: '16:30',
      endTime: '17:00',
      location: 'Beaconhouse, Block 4',
    });

    expect(response.json().data).toMatchObject({
      startTime: '16:30',
      endTime: '17:00',
      isAllDay: false,
      location: 'Beaconhouse, Block 4',
    });
  });

  it('rejects an event that ends before it starts', async () => {
    const response = await home.admin.agent.post(url, {
      title: 'Backwards trip',
      startDate: '2026-04-10',
      endDate: '2026-04-01',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.details[0].path).toBe('endDate');
  });

  it('rejects a participant from another household', async () => {
    const other = await seedHousehold(test);
    const response = await home.admin.agent.post(url, {
      title: 'Cross-household guest',
      startDate: '2026-04-10',
      participantMemberIds: [other.memberIds.adult],
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('recurring events', () => {
  it('repeats a birthday yearly and clamps 29 February', async () => {
    await home.admin.agent.post(url, {
      title: 'Leap birthday',
      eventType: 'birthday',
      startDate: '2024-02-29',
      recurrence: { freq: 'yearly', interval: 1 },
    });

    const list = await home.admin.agent.get(`${url}?perPage=50&from=2026-01-01&to=2027-12-31`);
    const dates = list.json().data.map((e: { startDate: string }) => e.startDate);
    // 2026 is not a leap year, so it lands on the 28th rather than vanishing.
    expect(dates).toContain('2026-02-28');
  });

  it('carries participants onto every generated occurrence', async () => {
    await home.admin.agent.post(url, {
      title: 'Friday family dinner',
      eventType: 'gathering',
      startDate: '2026-03-13',
      startTime: '20:00',
      participantMemberIds: [home.memberIds.admin, home.memberIds.adult],
      recurrence: { freq: 'weekly', interval: 1, count: 3 },
    });

    const list = await home.admin.agent.get(`${url}?perPage=50`);
    expect(list.json().meta.total).toBe(3);
    for (const event of list.json().data) {
      expect(event.participantMemberIds).toHaveLength(2);
      expect(event.startTime).toBe('20:00');
    }
  });
});

describe('the calendar window', () => {
  beforeEach(async () => {
    await home.admin.agent.post(url, { title: 'In March', startDate: '2026-03-15' });
    await home.admin.agent.post(url, { title: 'In April', startDate: '2026-04-15' });
    await home.admin.agent.post(url, {
      title: 'Spanning the boundary',
      startDate: '2026-03-28',
      endDate: '2026-04-04',
    });
  });

  it('returns events overlapping the requested range', async () => {
    const april = await home.admin.agent.get(`${url}?from=2026-04-01&to=2026-04-30`);
    const titles = april.json().data.map((e: { title: string }) => e.title).sort();
    // The multi-day event overlaps April even though it starts in March.
    expect(titles).toEqual(['In April', 'Spanning the boundary']);
  });

  it('filters by type', async () => {
    const response = await home.admin.agent.get(`${url}?eventType=birthday`);
    expect(response.json().meta.total).toBe(0);
  });
});

describe('updating and deleting', () => {
  it('replaces the participant list wholesale', async () => {
    const created = await home.admin.agent.post(url, {
      title: 'Family gathering',
      startDate: '2026-04-10',
      participantMemberIds: [home.memberIds.admin, home.memberIds.adult],
    });

    const updated = await home.admin.agent.patch(`${url}/${created.json().data.id}`, {
      participantMemberIds: [home.memberIds.teen],
    });
    expect(updated.json().data.participantMemberIds).toEqual([home.memberIds.teen]);
  });

  it('turns a timed event back into an all-day event', async () => {
    const created = await home.admin.agent.post(url, {
      title: 'Meeting',
      startDate: '2026-04-10',
      startTime: '10:00',
    });

    const updated = await home.admin.agent.patch(`${url}/${created.json().data.id}`, {
      startTime: null,
    });
    expect(updated.json().data).toMatchObject({ startTime: null, isAllDay: true });
  });

  it('soft-deletes', async () => {
    const created = await home.admin.agent.post(url, { title: 'Cancelled', startDate: '2026-04-10' });
    expect((await home.admin.agent.delete(`${url}/${created.json().data.id}`)).statusCode).toBe(204);
    expect((await home.admin.agent.get(`${url}/${created.json().data.id}`)).statusCode).toBe(404);
  });
});

describe('authorization and isolation', () => {
  it('lets a child read the family calendar but not add to it', async () => {
    const withLogins = await seedHousehold(test, { withLogins: ['child'] });
    const childUrl = `/api/v1/households/${withLogins.householdId}/events`;

    await withLogins.admin.agent.post(childUrl, { title: 'Eid', startDate: '2026-03-20' });

    expect((await withLogins.agents.child!.get(childUrl)).statusCode).toBe(200);
    expect(
      (await withLogins.agents.child!.post(childUrl, { title: 'Nope', startDate: '2026-03-21' }))
        .statusCode,
    ).toBe(403);
  });

  it('cannot reach another household’s event', async () => {
    const other = await seedHousehold(test);
    const theirs = await other.admin.agent.post(
      `/api/v1/households/${other.householdId}/events`,
      { title: 'Theirs', startDate: '2026-04-10' },
    );
    expect((await home.admin.agent.get(`${url}/${theirs.json().data.id}`)).statusCode).toBe(404);
  });
});

describe('events on the dashboard', () => {
  it('appears in this week but is never marked overdue', async () => {
    await home.admin.agent.post(url, { title: 'This week', startDate: '2026-03-13' });

    const dashboard = await home.admin.agent.get(
      `/api/v1/households/${home.householdId}/dashboard`,
    );
    const item = dashboard.json().data.thisWeek.find((i: { title: string }) => i.title === 'This week');
    expect(item).toBeTruthy();
    expect(item.isOverdue).toBe(false);
  });
});
