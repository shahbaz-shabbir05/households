import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTestApp, createTestApp, shutdownTestDatabase, type TestApp } from '../../test/setup.js';
import { registerUser, seedHousehold } from '../../test/factories.js';

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

describe('creating a household', () => {
  it('makes the creator an admin member in the same step', async () => {
    const { agent } = await registerUser(test, 'Ayesha');

    const response = await agent.post('/api/v1/households', {
      name: 'Khan Household',
      currency: 'PKR',
      timezone: 'Asia/Karachi',
      countryCode: 'PK',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({ name: 'Khan Household', role: 'admin' });
    expect(response.json().data.memberId).toBeTruthy();
  });

  it('defaults to PKR and Asia/Karachi without hard-coding them into the model', async () => {
    const { agent } = await registerUser(test);
    const response = await agent.post('/api/v1/households', { name: 'Defaults' });

    expect(response.json().data).toMatchObject({
      currency: 'PKR',
      timezone: 'Asia/Karachi',
      countryCode: 'PK',
    });
  });

  it('accepts a non-Pakistani household unchanged', async () => {
    const { agent } = await registerUser(test);
    const response = await agent.post('/api/v1/households', {
      name: 'London Flat',
      currency: 'GBP',
      timezone: 'Europe/London',
      countryCode: 'GB',
      locale: 'en-GB',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({ currency: 'GBP', timezone: 'Europe/London' });
  });

  it('rejects an invalid timezone or currency', async () => {
    const { agent } = await registerUser(test);

    const badZone = await agent.post('/api/v1/households', {
      name: 'Bad',
      timezone: 'Mars/Olympus_Mons',
    });
    expect(badZone.statusCode).toBe(400);

    const badCurrency = await agent.post('/api/v1/households', { name: 'Bad', currency: 'rupees' });
    expect(badCurrency.statusCode).toBe(400);
  });

  it('supports a user belonging to more than one household', async () => {
    const { agent } = await registerUser(test);
    await agent.post('/api/v1/households', { name: 'Our Home' });
    await agent.post('/api/v1/households', { name: "Parents' Home" });

    const response = await agent.get('/api/v1/households');
    expect(response.json().data).toHaveLength(2);
  });
});

describe('updating a household', () => {
  it('lets an admin change settings', async () => {
    const { householdId, admin } = await seedHousehold(test);

    const response = await admin.agent.patch(`/api/v1/households/${householdId}`, {
      name: 'Renamed Household',
      quietHoursStart: '23:00',
      quietHoursEnd: '06:30',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      name: 'Renamed Household',
      quietHoursStart: '23:00',
      quietHoursEnd: '06:30',
    });
  });

  it('records an audit entry describing what changed', async () => {
    const { householdId, admin } = await seedHousehold(test);
    await admin.agent.patch(`/api/v1/households/${householdId}`, { name: 'Audited Name' });

    const { auditLogs } = await import('../../db/schema/index.js');
    const { and, eq } = await import('drizzle-orm');
    const rows = await test.container.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.householdId, householdId), eq(auditLogs.entityType, 'household')));

    const update = rows.find((r) => r.action === 'update');
    expect(update).toBeTruthy();
    // Only the field that moved is recorded, not a whole-row snapshot.
    expect(update?.changes).toEqual({ name: { from: 'Test Household', to: 'Audited Name' } });
  });

  it('stops an adult from changing household settings', async () => {
    const { householdId, agents } = await seedHousehold(test, { withLogins: ['adult'] });

    const response = await agents.adult!.patch(`/api/v1/households/${householdId}`, {
      name: 'Adults Should Not Rename This',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('cannot be updated by a member of another household', async () => {
    const a = await seedHousehold(test);
    const b = await seedHousehold(test);

    const response = await a.admin.agent.patch(`/api/v1/households/${b.householdId}`, {
      name: 'Hijacked',
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /me', () => {
  it('returns the user and every household they can open', async () => {
    const { householdId, agents } = await seedHousehold(test, { withLogins: ['adult'] });

    const response = await agents.adult!.get('/api/v1/me');
    expect(response.statusCode).toBe(200);

    const body = response.json().data;
    expect(body.user.email).toContain('@');
    expect(body.households).toHaveLength(1);
    expect(body.households[0]).toMatchObject({ id: householdId, role: 'adult' });
  });
});
