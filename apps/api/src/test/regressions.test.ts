/**
 * Regressions.
 *
 * Each of these reproduces a bug that shipped on this branch. They live
 * together so the reason for each assertion stays visible — a fix without a
 * test is an invitation for the bug to come back.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTestApp, createTestApp, runJobOnce, shutdownTestDatabase, type TestApp } from './setup.js';
import { registerUser, seedHousehold, uniqueEmail, verifyEmail, TEST_PASSWORD } from './factories.js';

let test: TestApp;

beforeEach(async () => {
  test = await createTestApp();
  test.setNow(new Date('2026-09-22T06:00:00Z'));
});
afterEach(async () => {
  await closeTestApp(test);
});
afterAll(async () => {
  await shutdownTestDatabase();
});

describe('a recurring series that starts beyond the generation horizon', () => {
  it('still materialises its first occurrences', async () => {
    // The horizon used to run from today only, so a series whose first date is
    // further out than 90 days produced nothing — and the create failed with
    // "that repeat rule produces no dates".
    const home = await seedHousehold(test);

    const response = await home.admin.agent.post(
      `/api/v1/households/${home.householdId}/tasks`,
      {
        title: 'School fees',
        category: 'finance',
        dueDate: '2027-01-15',
        recurrence: { freq: 'monthly', interval: 1 },
      },
    );

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({ dueDate: '2027-01-15', isRecurring: true });

    const list = await home.admin.agent.get(
      `/api/v1/households/${home.householdId}/tasks?perPage=50&sort=dueDate&order=asc`,
    );
    expect(list.json().data[0].dueDate).toBe('2027-01-15');
    expect(list.json().meta.total).toBeGreaterThan(1);
  });
});

describe('the recurrence generator', () => {
  it('does no work on a second run the same day', async () => {
    // `lte` matched a series the same run had just handled, so every active
    // series was re-expanded and re-written on all 96 ticks a day.
    const home = await seedHousehold(test);
    await home.admin.agent.post(`/api/v1/households/${home.householdId}/tasks`, {
      title: 'Weekly laundry',
      dueDate: '2026-09-25',
      recurrence: { freq: 'weekly', interval: 1 },
    });

    const first = await runJobOnce(test, 'generateRecurrences', new Date('2026-09-22T07:00:00Z'));
    const second = await runJobOnce(test, 'generateRecurrences', new Date('2026-09-22T08:00:00Z'));

    expect(first).toBe(0); // already generated on create
    expect(second).toBe(0);
  });

  it('runs again the next day in the household’s own timezone', async () => {
    const home = await seedHousehold(test);
    await home.admin.agent.post(`/api/v1/households/${home.householdId}/tasks`, {
      title: 'Weekly laundry',
      dueDate: '2026-09-25',
      recurrence: { freq: 'weekly', interval: 1 },
    });

    const before = (
      await home.admin.agent.get(`/api/v1/households/${home.householdId}/tasks?perPage=100`)
    ).json().meta.total;

    // A month on, the horizon has moved and there is genuinely more to make.
    await runJobOnce(test, 'generateRecurrences', new Date('2026-10-15T06:00:00Z'));

    const after = (
      await home.admin.agent.get(`/api/v1/households/${home.householdId}/tasks?perPage=100`)
    ).json().meta.total;
    expect(after).toBeGreaterThan(before);
  });
});

describe('account lockout', () => {
  it('starts counting again once the lock has expired', async () => {
    // The counter was only cleared on success, so after ten failures every
    // later wrong password re-locked the account — one guess every fifteen
    // minutes would keep a known account locked out indefinitely.
    const { email } = await registerUser(test);
    const meta = { ip: '203.0.113.9', userAgent: 'vitest' };

    for (let i = 0; i < 10; i += 1) {
      await expect(
        test.container.auth.login({ email, password: `wrong-${i}-aaaa` }, meta),
      ).rejects.toThrow();
    }
    await expect(
      test.container.auth.login({ email, password: TEST_PASSWORD }, meta),
    ).rejects.toThrow(/too many failed attempts/i);

    // Sixteen minutes later the lock has expired.
    test.setNow(new Date('2026-09-22T06:16:00Z'));

    // One more wrong password must not immediately re-lock the account…
    await expect(
      test.container.auth.login({ email, password: 'wrong-again-aaaa' }, meta),
    ).rejects.toThrow(/email or password is incorrect/i);

    // …and the real password must work.
    const result = await test.container.auth.login({ email, password: TEST_PASSWORD }, meta);
    expect(result.user.email).toBe(email);
  });
});

describe('editing an event', () => {
  it('does not silently change its type', async () => {
    // The update schema inherited `eventType: default('other')`, so renaming a
    // birthday converted it and dropped it out of the birthday views.
    const home = await seedHousehold(test);
    const created = await home.admin.agent.post(`/api/v1/households/${home.householdId}/events`, {
      title: 'Zara’s birthday',
      eventType: 'birthday',
      startDate: '2027-04-18',
    });

    const updated = await home.admin.agent.patch(
      `/api/v1/households/${home.householdId}/events/${created.json().data.id}`,
      { title: 'Zara’s birthday 2027' },
    );

    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.eventType).toBe('birthday');
  });
});

describe('inviting someone who is then removed', () => {
  it('revokes the invitation rather than letting them join a deleted member', async () => {
    // Accepting used to succeed and set userId on a soft-deleted row, so the
    // invitee landed in a household where every route returned 404.
    const home = await seedHousehold(test);
    const email = uniqueEmail('invitee');

    await home.admin.agent.post(`/api/v1/households/${home.householdId}/invites`, {
      memberId: home.memberIds.adult,
      email,
    });
    const token = /accept-invite\?token=([\w-]+)/.exec(test.mailer.lastTo(email)?.text ?? '')?.[1];
    expect(token).toBeTruthy();

    await home.admin.agent.delete(
      `/api/v1/households/${home.householdId}/members/${home.memberIds.adult}`,
    );

    const { Agent } = await import('./setup.js');
    const invitee = new Agent(test.app);
    await invitee.post('/api/v1/auth/register', {
      email,
      password: TEST_PASSWORD,
      displayName: 'Invited',
    });

    const accepted = await invitee.post('/api/v1/invites/accept', { token });
    expect(accepted.statusCode).toBe(400);

    // And they are not left half-joined.
    const me = await invitee.get('/api/v1/me');
    expect(me.json().data.households).toHaveLength(0);
  });
});

describe('boolean query parameters', () => {
  it('honours includeInactive=false instead of inverting it', async () => {
    const home = await seedHousehold(test);
    // Marked inactive rather than removed: `delete` also sets deletedAt, and a
    // removed member is filtered out regardless of this flag.
    await home.admin.agent.patch(
      `/api/v1/households/${home.householdId}/members/${home.memberIds.teen}`,
      { isActive: false },
    );

    const active = await home.admin.agent.get(
      `/api/v1/households/${home.householdId}/members?includeInactive=false`,
    );
    const ids = active.json().data.map((m: { id: string }) => m.id);
    expect(ids).not.toContain(home.memberIds.teen);

    const all = await home.admin.agent.get(
      `/api/v1/households/${home.householdId}/members?includeInactive=true`,
    );
    expect(all.json().data.length).toBeGreaterThan(ids.length);
  });

  it('honours lowStock=false on inventory', async () => {
    const home = await seedHousehold(test);
    const url = `/api/v1/households/${home.householdId}/inventory`;
    await home.admin.agent.post(url, { name: 'Milk', quantity: 1, minQuantity: 2 });
    await home.admin.agent.post(url, { name: 'Rice', quantity: 10, minQuantity: 2 });

    expect((await home.admin.agent.get(`${url}?lowStock=false`)).json().meta.total).toBe(2);
    expect((await home.admin.agent.get(`${url}?lowStock=true`)).json().meta.total).toBe(1);
  });
});

describe('unverified invites', () => {
  it('still requires the inviter to have verified their own address', async () => {
    const home = await seedHousehold(test);
    await verifyEmail(test, home.admin.email, home.admin.agent);
    const response = await home.admin.agent.post(
      `/api/v1/households/${home.householdId}/invites`,
      { memberId: home.memberIds.child, email: uniqueEmail() },
    );
    expect(response.statusCode).toBe(202);
  });
});
