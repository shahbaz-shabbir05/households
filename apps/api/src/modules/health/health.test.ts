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

beforeEach(async () => {
  test = await createTestApp();
  test.setNow(new Date('2026-10-29T06:00:00Z')); // 11:00 in Karachi
  home = await seedHousehold(test);
  base = `/api/v1/households/${home.householdId}`;
});
afterEach(async () => {
  await closeTestApp(test);
});
afterAll(async () => {
  await shutdownTestDatabase();
});

const newMedicine = (over: Record<string, unknown> = {}) =>
  home.admin.agent.post(`${base}/medicines`, {
    memberId: home.memberIds.admin,
    name: 'Amoxicillin',
    doseText: '1 tablet',
    frequencyText: 'twice daily, after food',
    reminderTimes: ['09:00', '21:00'],
    startDate: '2026-10-29',
    ...over,
  });

/**
 * The rule the whole module is built around. These are not style preferences:
 * a system that reinterprets a dose is a system that can get a dose wrong.
 */
describe('the safety rule: record and remind, never interpret', () => {
  it('returns the dose exactly as it was typed', async () => {
    const odd = 'half a 500mg tablet, dissolved in water';
    const response = await newMedicine({ doseText: odd });

    expect(response.statusCode).toBe(201);
    // Byte-for-byte. Not normalised, not parsed into an amount and a unit.
    expect(response.json().data.doseText).toBe(odd);
  });

  it('keeps the frequency text as prose rather than turning it into a schedule', async () => {
    const response = await newMedicine({
      frequencyText: 'every 8 hours as needed, max 3 a day',
      reminderTimes: [],
    });

    expect(response.json().data.frequencyText).toBe('every 8 hours as needed, max 3 a day');
    // "every 8 hours" did NOT become three reminder times. Somebody chooses.
    expect(response.json().data.reminderTimes).toEqual([]);

    const doses = await home.admin.agent.get(`${base}/doses?from=2026-10-29&to=2026-11-05`);
    expect(doses.json().data).toEqual([]);
  });

  it('only schedules the times the household entered', async () => {
    await newMedicine({ reminderTimes: ['08:00', '14:00', '20:00'] });

    const doses = await home.admin.agent.get(`${base}/doses?from=2026-10-29&to=2026-10-29`);
    expect(doses.json().data.map((d: { scheduledAtTime: string }) => d.scheduledAtTime)).toEqual([
      '08:00',
      '14:00',
      '20:00',
    ]);
  });

  it('decrements the count by one unit, never by a number read out of the dose', async () => {
    // "2 tablets" must not be read as "subtract 2" — the system has no idea
    // whether the household counts tablets, bottles or strips.
    const medicine = await newMedicine({
      doseText: '2 tablets',
      reminderTimes: ['09:00'],
      quantityRemaining: 10,
    });

    const doses = await home.admin.agent.get(`${base}/doses?from=2026-10-29&to=2026-10-29`);
    await home.admin.agent.post(`${base}/doses/${doses.json().data[0].id}/record`, {
      status: 'taken',
    });

    const after = await home.admin.agent.get(`${base}/medicines/${medicine.json().data.id}`);
    expect(after.json().data.quantityRemaining).toBe(9);
  });

  it('offers no way to change a dose amount through the dose endpoint', async () => {
    await newMedicine({ reminderTimes: ['09:00'] });
    const doses = await home.admin.agent.get(`${base}/doses?from=2026-10-29&to=2026-10-29`);
    const doseId = doses.json().data[0].id;

    // Unknown keys are stripped at the boundary; there is no field to set.
    const response = await home.admin.agent.post(`${base}/doses/${doseId}/record`, {
      status: 'taken',
      doseText: '5 tablets',
      quantityRemaining: 999,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.doseText).toBe('1 tablet');
  });

  it('quotes the dose verbatim in the audit record', async () => {
    const created = await newMedicine({ doseText: '7.5ml' });

    const { auditLogs } = await import('../../db/schema/index.js');
    const { and, eq } = await import('drizzle-orm');
    const rows = await test.container.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.entityType, 'medicine'), eq(auditLogs.entityId, created.json().data.id)),
      );

    expect(rows[0]!.summary).toContain('7.5ml');
  });
});

describe('the dose schedule', () => {
  it('generates one dose per time per day, ahead of time', async () => {
    await newMedicine({ reminderTimes: ['09:00', '21:00'] });

    const week = await home.admin.agent.get(`${base}/doses?from=2026-10-29&to=2026-11-04`);
    // Seven days, twice a day.
    expect(week.json().data).toHaveLength(14);
  });

  it('stops at the end of the course', async () => {
    await newMedicine({ reminderTimes: ['09:00'], endDate: '2026-10-31' });

    const doses = await home.admin.agent.get(`${base}/doses?from=2026-10-29&to=2026-11-30`);
    const dates = doses.json().data.map((d: { scheduledOn: string }) => d.scheduledOn);
    expect(dates).toEqual(['2026-10-29', '2026-10-30', '2026-10-31']);
  });

  it('does not backfill doses from before today', async () => {
    // A dose nobody could have been reminded about is not one they missed.
    await newMedicine({ reminderTimes: ['09:00'], startDate: '2026-10-01' });

    const doses = await home.admin.agent.get(`${base}/doses?from=2026-10-01&to=2026-10-29`);
    const dates = doses.json().data.map((d: { scheduledOn: string }) => d.scheduledOn);
    expect(dates).toEqual(['2026-10-29']);
  });

  it('creates no duplicates when the sweep runs again', async () => {
    await newMedicine({ reminderTimes: ['09:00'] });
    const before = (
      await home.admin.agent.get(`${base}/doses?from=2026-10-29&to=2026-12-31`)
    ).json().data.length;

    await runJobOnce(test, 'medicineSweep', new Date('2026-10-29T07:00:00Z'));
    await runJobOnce(test, 'medicineSweep', new Date('2026-10-29T08:00:00Z'));

    const after = (
      await home.admin.agent.get(`${base}/doses?from=2026-10-29&to=2026-12-31`)
    ).json().data.length;
    expect(after).toBe(before);
  });

  it('rebuilds the schedule when the times change, keeping what was recorded', async () => {
    const medicine = await newMedicine({ reminderTimes: ['09:00', '21:00'] });
    const medicineId = medicine.json().data.id;

    const doses = await home.admin.agent.get(`${base}/doses?from=2026-10-29&to=2026-10-29`);
    await home.admin.agent.post(`${base}/doses/${doses.json().data[0].id}/record`, {
      status: 'taken',
    });

    await home.admin.agent.patch(`${base}/medicines/${medicineId}`, {
      reminderTimes: ['08:00'],
    });

    const today = await home.admin.agent.get(`${base}/doses?from=2026-10-29&to=2026-10-29`);
    const times = today.json().data.map((d: { scheduledAtTime: string }) => d.scheduledAtTime).sort();
    // The taken 09:00 dose is history and survives; the untaken 21:00 is gone.
    expect(times).toEqual(['08:00', '09:00']);
  });

  it('rejects a course that ends before it starts', async () => {
    const response = await newMedicine({ startDate: '2026-11-01', endDate: '2026-10-01' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.details[0].path).toBe('endDate');
  });
});

describe('recording doses', () => {
  const firstDose = async () => {
    const doses = await home.admin.agent.get(`${base}/doses?from=2026-10-29&to=2026-10-29`);
    return doses.json().data[0];
  };

  it('records a dose as taken', async () => {
    await newMedicine({ reminderTimes: ['09:00'] });
    const dose = await firstDose();

    const response = await home.admin.agent.post(`${base}/doses/${dose.id}/record`, {
      status: 'taken',
    });
    expect(response.json().data.status).toBe('taken');
    expect(response.json().data.recordedAt).toBeTruthy();
  });

  it('records a skipped dose honestly rather than deleting it', async () => {
    await newMedicine({ reminderTimes: ['09:00'], quantityRemaining: 10 });
    const dose = await firstDose();

    await home.admin.agent.post(`${base}/doses/${dose.id}/record`, { status: 'skipped' });

    const after = await home.admin.agent.get(`${base}/doses?from=2026-10-29&to=2026-10-29`);
    expect(after.json().data[0].status).toBe('skipped');
  });

  it('does not decrement the count for a skipped dose', async () => {
    const medicine = await newMedicine({ reminderTimes: ['09:00'], quantityRemaining: 10 });
    const dose = await firstDose();

    await home.admin.agent.post(`${base}/doses/${dose.id}/record`, { status: 'skipped' });

    const after = await home.admin.agent.get(`${base}/medicines/${medicine.json().data.id}`);
    expect(after.json().data.quantityRemaining).toBe(10);
  });

  it('can record without touching the count', async () => {
    const medicine = await newMedicine({ reminderTimes: ['09:00'], quantityRemaining: 10 });
    const dose = await firstDose();

    await home.admin.agent.post(`${base}/doses/${dose.id}/record`, {
      status: 'taken',
      decrementStock: false,
    });

    const after = await home.admin.agent.get(`${base}/medicines/${medicine.json().data.id}`);
    expect(after.json().data.quantityRemaining).toBe(10);
  });

  it('refuses to record the same dose twice', async () => {
    await newMedicine({ reminderTimes: ['09:00'], quantityRemaining: 10 });
    const dose = await firstDose();

    await home.admin.agent.post(`${base}/doses/${dose.id}/record`, { status: 'taken' });
    const second = await home.admin.agent.post(`${base}/doses/${dose.id}/record`, {
      status: 'taken',
    });

    // Otherwise the count drifts down every time someone taps twice.
    expect(second.statusCode).toBe(409);
  });

  it('never lets the count go below zero', async () => {
    const medicine = await newMedicine({ reminderTimes: ['09:00', '21:00'], quantityRemaining: 1 });
    const doses = await home.admin.agent.get(`${base}/doses?from=2026-10-29&to=2026-10-29`);

    for (const dose of doses.json().data) {
      await home.admin.agent.post(`${base}/doses/${dose.id}/record`, { status: 'taken' });
    }

    const after = await home.admin.agent.get(`${base}/medicines/${medicine.json().data.id}`);
    expect(after.json().data.quantityRemaining).toBe(0);
  });
});

describe('the sweep', () => {
  it('marks a dose missed once it is well past, rather than hiding it', async () => {
    await newMedicine({ reminderTimes: ['09:00'] });

    // 09:00 Karachi on the 29th is 04:00Z; seven hours later it is long gone.
    await runJobOnce(test, 'medicineSweep', new Date('2026-10-29T11:00:00Z'));

    const doses = await home.admin.agent.get(`${base}/doses?from=2026-10-29&to=2026-10-29`);
    expect(doses.json().data[0].status).toBe('missed');
  });

  it('leaves a dose that has only just come due alone', async () => {
    await newMedicine({ reminderTimes: ['09:00'] });
    await runJobOnce(test, 'medicineSweep', new Date('2026-10-29T05:00:00Z'));

    const doses = await home.admin.agent.get(`${base}/doses?from=2026-10-29&to=2026-10-29`);
    expect(doses.json().data[0].status).toBe('due');
  });

  it('reminds about a dose that is due', async () => {
    await newMedicine({ reminderTimes: ['09:00'] });
    await runJobOnce(test, 'medicineSweep', new Date('2026-10-29T04:30:00Z'));

    const inbox = await home.admin.agent.get(`${base}/notifications`);
    const dose = inbox.json().data.find((n: { type: string }) => n.type === 'medicine.due');
    expect(dose).toBeTruthy();
    // The notification carries the dose verbatim, so the screen matches the box.
    expect(dose.title).toBe('Amoxicillin — 1 tablet');
  });

  it('does not remind twice about the same dose', async () => {
    await newMedicine({ reminderTimes: ['09:00'] });
    await runJobOnce(test, 'medicineSweep', new Date('2026-10-29T04:30:00Z'));
    await runJobOnce(test, 'medicineSweep', new Date('2026-10-29T04:45:00Z'));

    const inbox = await home.admin.agent.get(`${base}/notifications`);
    const doseNotices = inbox.json().data.filter((n: { type: string }) => n.type === 'medicine.due');
    expect(doseNotices).toHaveLength(1);
  });

  it('flags a medicine that is running low', async () => {
    await newMedicine({ reminderTimes: [], quantityRemaining: 2, refillThreshold: 3 });
    await runJobOnce(test, 'medicineSweep', new Date('2026-10-29T07:00:00Z'));

    const inbox = await home.admin.agent.get(`${base}/notifications`);
    const refill = inbox.json().data.find((n: { type: string }) => n.type === 'medicine.refill');
    expect(refill.title).toBe('Amoxicillin is running low');
  });

  it('stops flagging once it has been refilled', async () => {
    const medicine = await newMedicine({
      reminderTimes: [],
      quantityRemaining: 2,
      refillThreshold: 3,
    });
    await runJobOnce(test, 'medicineSweep', new Date('2026-10-29T07:00:00Z'));

    await home.admin.agent.post(`${base}/medicines/${medicine.json().data.id}/refill`, {
      quantityAdded: 30,
    });

    const after = await home.admin.agent.get(`${base}/medicines/${medicine.json().data.id}`);
    expect(after.json().data.quantityRemaining).toBe(32);
    expect(after.json().data.needsRefill).toBe(false);
  });
});

describe('appointments', () => {
  const newAppointment = (over: Record<string, unknown> = {}) =>
    home.admin.agent.post(`${base}/appointments`, {
      memberId: home.memberIds.child,
      doctorName: 'Dr Saleem',
      scheduledOn: '2026-11-03',
      scheduledAtTime: '16:30',
      reason: 'Annual check-up',
      ...over,
    });

  it('books an appointment and creates the doctor on first mention', async () => {
    const response = await newAppointment();

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      doctorName: 'Dr Saleem',
      scheduledOn: '2026-11-03',
      scheduledAtTime: '16:30',
      status: 'scheduled',
    });

    const doctorList = await home.admin.agent.get(`${base}/doctors`);
    expect(doctorList.json().data).toHaveLength(1);
  });

  it('reuses the same doctor for a second appointment', async () => {
    await newAppointment();
    await newAppointment({ scheduledOn: '2026-12-03' });

    expect((await home.admin.agent.get(`${base}/doctors`)).json().data).toHaveLength(1);
  });

  it('records what the doctor said, verbatim', async () => {
    const created = await newAppointment();
    const notes = 'Continue the current course. Review in 6 weeks if no better.';

    const updated = await home.admin.agent.patch(
      `${base}/appointments/${created.json().data.id}`,
      { status: 'completed', outcomeNotes: notes, followUpOn: '2026-12-15' },
    );

    expect(updated.json().data.outcomeNotes).toBe(notes);
    expect(updated.json().data.followUpOn).toBe('2026-12-15');
  });

  it('rejects a follow-up before the appointment itself', async () => {
    const created = await newAppointment();
    const response = await home.admin.agent.patch(
      `${base}/appointments/${created.json().data.id}`,
      { followUpOn: '2026-10-01' },
    );
    expect(response.statusCode).toBe(400);
  });

  it('reminds inside the notice window, once per day', async () => {
    await newAppointment({ scheduledOn: '2026-10-30', remindDaysBefore: 1 });

    await runJobOnce(test, 'appointmentReminders', new Date('2026-10-29T07:00:00Z'));
    await runJobOnce(test, 'appointmentReminders', new Date('2026-10-29T08:00:00Z'));

    // It is the child's appointment, so the child is the one told.
    const { notifications } = await import('../../db/schema/index.js');
    const { eq } = await import('drizzle-orm');
    const rows = await test.container.db
      .select()
      .from(notifications)
      .where(eq(notifications.memberId, home.memberIds.child));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('appointment.upcoming');
  });

  it('says nothing about an appointment still beyond its window', async () => {
    await newAppointment({ scheduledOn: '2026-11-20', remindDaysBefore: 1 });
    expect(await runJobOnce(test, 'appointmentReminders', new Date('2026-10-29T07:00:00Z'))).toBe(0);
  });

  it('repeats when asked', async () => {
    await newAppointment({
      scheduledOn: '2026-11-03',
      recurrence: { freq: 'monthly', interval: 1, count: 3 },
    });

    const list = await home.admin.agent.get(`${base}/appointments?perPage=50`);
    expect(list.json().meta.total).toBe(3);
  });
});

describe('who can see whose health records', () => {
  it('shows a teen their own medicines and nobody else’s', async () => {
    const withLogins = await seedHousehold(test, { withLogins: ['teen'] });
    const theirBase = `/api/v1/households/${withLogins.householdId}`;

    await withLogins.admin.agent.post(`${theirBase}/medicines`, {
      memberId: withLogins.memberIds.teen,
      name: 'Theirs',
      doseText: '1 tablet',
      startDate: '2026-10-29',
    });
    await withLogins.admin.agent.post(`${theirBase}/medicines`, {
      memberId: withLogins.memberIds.admin,
      name: 'A parent’s',
      doseText: '1 tablet',
      startDate: '2026-10-29',
    });

    const visible = await withLogins.agents.teen!.get(`${theirBase}/medicines`);
    expect(visible.json().data.map((m: { name: string }) => m.name)).toEqual(['Theirs']);
  });

  it('stops a teen opening a parent’s medicine directly', async () => {
    const withLogins = await seedHousehold(test, { withLogins: ['teen'] });
    const theirBase = `/api/v1/households/${withLogins.householdId}`;

    const parents = await withLogins.admin.agent.post(`${theirBase}/medicines`, {
      memberId: withLogins.memberIds.admin,
      name: 'A parent’s',
      doseText: '1 tablet',
      startDate: '2026-10-29',
    });

    const response = await withLogins.agents.teen!.get(
      `${theirBase}/medicines/${parents.json().data.id}`,
    );
    expect(response.statusCode).toBe(403);
  });

  it('lets a teen record their own dose', async () => {
    const withLogins = await seedHousehold(test, { withLogins: ['teen'] });
    const theirBase = `/api/v1/households/${withLogins.householdId}`;

    await withLogins.admin.agent.post(`${theirBase}/medicines`, {
      memberId: withLogins.memberIds.teen,
      name: 'Theirs',
      doseText: '1 tablet',
      reminderTimes: ['09:00'],
      startDate: '2026-10-29',
    });

    const doses = await withLogins.agents.teen!.get(`${theirBase}/doses?from=2026-10-29&to=2026-10-29`);
    const response = await withLogins.agents.teen!.post(
      `${theirBase}/doses/${doses.json().data[0].id}/record`,
      { status: 'taken' },
    );
    expect(response.statusCode).toBe(200);
  });

  it('keeps health records away from a helper entirely', async () => {
    const withLogins = await seedHousehold(test, { withLogins: ['helper'] });
    const theirBase = `/api/v1/households/${withLogins.householdId}`;

    expect((await withLogins.agents.helper!.get(`${theirBase}/medicines`)).statusCode).toBe(403);
    expect((await withLogins.agents.helper!.get(`${theirBase}/appointments`)).statusCode).toBe(403);
    expect((await withLogins.agents.helper!.get(`${theirBase}/doctors`)).statusCode).toBe(403);
  });

  it('cannot reach another household’s records', async () => {
    const other = await seedHousehold(test);
    const theirs = await other.admin.agent.post(
      `/api/v1/households/${other.householdId}/medicines`,
      {
        memberId: other.memberIds.admin,
        name: 'Theirs',
        doseText: '1 tablet',
        startDate: '2026-10-29',
      },
    );

    const id = theirs.json().data.id;
    expect((await home.admin.agent.get(`${base}/medicines/${id}`)).statusCode).toBe(404);
    expect((await home.admin.agent.delete(`${base}/medicines/${id}`)).statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const anonymous = new Agent(test.app);
    expect((await anonymous.get(`${base}/medicines`)).statusCode).toBe(401);
    expect((await anonymous.get(`${base}/doses`)).statusCode).toBe(401);
  });
});

describe('the dashboard', () => {
  it('shows today’s doses with the dose text, not a summary of it', async () => {
    await newMedicine({ doseText: '5ml', reminderTimes: ['09:00'] });

    const dashboard = await home.admin.agent.get(`${base}/dashboard`);
    const all = [
      ...dashboard.json().data.needsAttention,
      ...dashboard.json().data.today,
      ...dashboard.json().data.thisWeek,
    ];
    const dose = all.find((i: { entityType: string }) => i.entityType === 'medicine_dose');
    expect(dose.title).toBe('Amoxicillin — 5ml');
  });

  it('shows an upcoming appointment', async () => {
    await home.admin.agent.post(`${base}/appointments`, {
      memberId: home.memberIds.admin,
      doctorName: 'Dr Saleem',
      scheduledOn: '2026-10-31',
    });

    const dashboard = await home.admin.agent.get(`${base}/dashboard`);
    const all = [...dashboard.json().data.today, ...dashboard.json().data.thisWeek];
    expect(all.some((i: { title: string }) => i.title === 'Appointment with Dr Saleem')).toBe(true);
  });
});
