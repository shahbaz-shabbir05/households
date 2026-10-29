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
let url: string;

beforeEach(async () => {
  test = await createTestApp();
  test.setNow(new Date('2026-03-10T06:00:00Z')); // Tuesday, 11:00 in Karachi
  home = await seedHousehold(test);
  url = `/api/v1/households/${home.householdId}/tasks`;
});
afterEach(async () => {
  await closeTestApp(test);
});
afterAll(async () => {
  await shutdownTestDatabase();
});

describe('creating tasks', () => {
  it('creates a one-off task', async () => {
    const response = await home.admin.agent.post(url, {
      title: 'Clean the water filter',
      category: 'maintenance',
      priority: 'high',
      dueDate: '2026-03-12',
      assigneeMemberId: home.memberIds.adult,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      title: 'Clean the water filter',
      category: 'maintenance',
      priority: 'high',
      dueDate: '2026-03-12',
      status: 'pending',
      isRecurring: false,
      isOverdue: false,
    });
    expect(response.json().data.assigneeName).toBe('adult member');
  });

  it('marks a past-due task as overdue in household time', async () => {
    const response = await home.admin.agent.post(url, {
      title: 'Overdue already',
      dueDate: '2026-03-01',
    });
    expect(response.json().data.isOverdue).toBe(true);
  });

  it('rejects an assignee from another household', async () => {
    const other = await seedHousehold(test);
    const response = await home.admin.agent.post(url, {
      title: 'Cross-household assignment',
      assigneeMemberId: other.memberIds.adult,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details[0].path).toBe('assigneeMemberId');
  });

  it('requires a due date before a task can repeat', async () => {
    const response = await home.admin.agent.post(url, {
      title: 'Repeating with no anchor',
      recurrence: { freq: 'weekly', interval: 1 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.details[0].path).toBe('dueDate');
  });
});

describe('recurring tasks', () => {
  it('materialises the horizon immediately, so the user sees future occurrences', async () => {
    const created = await home.admin.agent.post(url, {
      title: 'Clean the water filter',
      category: 'chore',
      dueDate: '2026-03-15',
      recurrence: { freq: 'monthly', interval: 1 },
    });

    expect(created.statusCode).toBe(201);
    // The first occurrence is returned — that is what the user just described.
    expect(created.json().data).toMatchObject({ dueDate: '2026-03-15', isRecurring: true });

    const list = await home.admin.agent.get(`${url}?perPage=50`);
    const dates = list.json().data.map((t: { dueDate: string }) => t.dueDate);
    // The 90-day horizon from 2026-03-10 reaches 2026-06-08, so June's
    // occurrence is correctly outside it until the horizon rolls forward.
    expect(dates).toEqual(['2026-03-15', '2026-04-15', '2026-05-15']);
  });

  it('clamps a month-end repeat instead of skipping the month', async () => {
    await home.admin.agent.post(url, {
      title: 'Pay the rent',
      category: 'finance',
      dueDate: '2026-01-31',
      recurrence: { freq: 'monthly', interval: 1 },
    });

    const list = await home.admin.agent.get(`${url}?perPage=50&sort=dueDate&order=asc`);
    const dates = list.json().data.map((t: { dueDate: string }) => t.dueDate);
    // February must not be skipped: rent is still due.
    expect(dates).toContain('2026-02-28');
  });

  it('creates no duplicates when the generator runs again', async () => {
    await home.admin.agent.post(url, {
      title: 'Weekly laundry',
      category: 'chore',
      dueDate: '2026-03-12',
      recurrence: { freq: 'weekly', interval: 1 },
    });

    const before = (await home.admin.agent.get(`${url}?perPage=100`)).json().meta.total;

    // Run the generator twice more. The unique index on
    // series_occurrences is what makes this safe, not careful code (docs/08).
    await runJobOnce(test, 'generateRecurrences', new Date('2026-03-10T07:00:00Z'));
    await runJobOnce(test, 'generateRecurrences', new Date('2026-03-10T08:00:00Z'));

    const after = (await home.admin.agent.get(`${url}?perPage=100`)).json().meta.total;
    expect(after).toBe(before);
  });

  it('extends the horizon as time passes', async () => {
    await home.admin.agent.post(url, {
      title: 'Weekly laundry',
      dueDate: '2026-03-12',
      recurrence: { freq: 'weekly', interval: 1 },
    });
    const before = (await home.admin.agent.get(`${url}?perPage=100`)).json().meta.total;

    // A month later the 90-day window has moved forward.
    await runJobOnce(test, 'generateRecurrences', new Date('2026-04-10T06:00:00Z'));

    const after = (await home.admin.agent.get(`${url}?perPage=100`)).json().meta.total;
    expect(after).toBeGreaterThan(before);
  });

  it('does not overwrite an edited occurrence on the next run', async () => {
    const created = await home.admin.agent.post(url, {
      title: 'Weekly laundry',
      dueDate: '2026-03-12',
      recurrence: { freq: 'weekly', interval: 1 },
    });
    const taskId = created.json().data.id;

    await home.admin.agent.patch(`${url}/${taskId}`, { title: 'Laundry — whites only this week' });

await runJobOnce(test, 'generateRecurrences', new Date('2026-03-11T06:00:00Z'));

    const reread = await home.admin.agent.get(`${url}/${taskId}`);
    expect(reread.json().data.title).toBe('Laundry — whites only this week');
  });

  it('stops future occurrences when the series is ended', async () => {
    const created = await home.admin.agent.post(url, {
      title: 'Weekly laundry',
      dueDate: '2026-03-12',
      recurrence: { freq: 'weekly', interval: 1 },
    });
    const taskId = created.json().data.id;

    await home.admin.agent.post(`${url}/${taskId}/stop-recurrence`, {});

const before = (await home.admin.agent.get(`${url}?perPage=100`)).json().meta.total;
    await runJobOnce(test, 'generateRecurrences', new Date('2026-06-10T06:00:00Z'));
    const after = (await home.admin.agent.get(`${url}?perPage=100`)).json().meta.total;

    expect(after).toBe(before);
  });

  it('deletes this and following occurrences but keeps completed history', async () => {
    const created = await home.admin.agent.post(url, {
      title: 'Weekly laundry',
      dueDate: '2026-03-12',
      recurrence: { freq: 'weekly', interval: 1 },
    });
    const firstId = created.json().data.id;

    const all = await home.admin.agent.get(`${url}?perPage=100&sort=dueDate&order=asc`);
    const second = all.json().data[1];

    // Complete the first, then delete from the second onwards.
    await home.admin.agent.post(`${url}/${firstId}/complete`, { completed: true });
    await home.admin.agent.delete(`${url}/${second.id}?scope=following`);

    const remaining = await home.admin.agent.get(`${url}?perPage=100`);
    const ids = remaining.json().data.map((t: { id: string }) => t.id);
    expect(ids).toContain(firstId); // completed history survives
    expect(ids).not.toContain(second.id);
    expect(remaining.json().meta.total).toBe(1);
  });
});

describe('completing tasks', () => {
  it('records who completed it and when', async () => {
    const created = await home.admin.agent.post(url, { title: 'Take out the rubbish' });
    const taskId = created.json().data.id;

    const done = await home.admin.agent.post(`${url}/${taskId}/complete`, { completed: true });
    expect(done.json().data).toMatchObject({
      status: 'completed',
      completedByMemberId: home.memberIds.admin,
    });
    expect(done.json().data.completedAt).toBeTruthy();
  });

  it('is idempotent — ticking twice is not an error', async () => {
    const created = await home.admin.agent.post(url, { title: 'Take out the rubbish' });
    const taskId = created.json().data.id;

    await home.admin.agent.post(`${url}/${taskId}/complete`, { completed: true });
    const second = await home.admin.agent.post(`${url}/${taskId}/complete`, { completed: true });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.status).toBe('completed');
  });

  it('clears the completion stamp when reopened', async () => {
    const created = await home.admin.agent.post(url, { title: 'Take out the rubbish' });
    const taskId = created.json().data.id;

    await home.admin.agent.post(`${url}/${taskId}/complete`, { completed: true });
    const reopened = await home.admin.agent.post(`${url}/${taskId}/complete`, { completed: false });

    expect(reopened.json().data).toMatchObject({
      status: 'pending',
      completedAt: null,
      completedByMemberId: null,
    });
  });
});

describe('filtering and sorting', () => {
  beforeEach(async () => {
    await home.admin.agent.post(url, { title: 'Overdue chore', category: 'chore', dueDate: '2026-03-01' });
    await home.admin.agent.post(url, { title: 'Due today', dueDate: '2026-03-10', priority: 'urgent' });
    await home.admin.agent.post(url, {
      title: 'Assigned to the helper',
      category: 'chore',
      dueDate: '2026-03-20',
      assigneeMemberId: home.memberIds.helper,
    });
  });

  it('filters by overdue, category and assignee', async () => {
    const overdue = await home.admin.agent.get(`${url}?overdue=true`);
    expect(overdue.json().data.map((t: { title: string }) => t.title)).toEqual(['Overdue chore']);

    const chores = await home.admin.agent.get(`${url}?category=chore`);
    expect(chores.json().meta.total).toBe(2);

    const helperTasks = await home.admin.agent.get(`${url}?assigneeMemberId=${home.memberIds.helper}`);
    expect(helperTasks.json().meta.total).toBe(1);
  });

  it('searches titles without treating input as a wildcard', async () => {
    await home.admin.agent.post(url, { title: '100% cotton wash' });

    const literal = await home.admin.agent.get(`${url}?search=100%25`);
    expect(literal.json().meta.total).toBe(1);

    // A bare % must not match everything.
    const wildcardAttempt = await home.admin.agent.get(`${url}?search=%25%25%25`);
    expect(wildcardAttempt.json().meta.total).toBe(0);
  });

  it('paginates', async () => {
    const page = await home.admin.agent.get(`${url}?perPage=2&page=1`);
    expect(page.json().data).toHaveLength(2);
    expect(page.json().meta).toMatchObject({ page: 1, perPage: 2, total: 3, totalPages: 2 });
  });

  it('rejects an unknown sort field rather than interpolating it', async () => {
    const response = await home.admin.agent.get(`${url}?sort=password`);
    expect(response.statusCode).toBe(400);
  });
});

describe('authorization', () => {
  it('shows a helper only the tasks assigned to them', async () => {
    const withLogins = await seedHousehold(test, { withLogins: ['helper'] });
    const helperUrl = `/api/v1/households/${withLogins.householdId}/tasks`;

    await withLogins.admin.agent.post(helperUrl, { title: 'Not theirs', dueDate: '2026-03-12' });
    await withLogins.admin.agent.post(helperUrl, {
      title: 'Theirs',
      dueDate: '2026-03-12',
      assigneeMemberId: withLogins.memberIds.helper,
    });

    const response = await withLogins.agents.helper!.get(helperUrl);
    expect(response.json().data.map((t: { title: string }) => t.title)).toEqual(['Theirs']);
  });

  it('stops a child editing a sibling’s task', async () => {
    const withLogins = await seedHousehold(test, { withLogins: ['child'] });
    const childUrl = `/api/v1/households/${withLogins.householdId}/tasks`;

    const someone = await withLogins.admin.agent.post(childUrl, {
      title: 'Not the child’s task',
      assigneeMemberId: withLogins.memberIds.teen,
    });

    const response = await withLogins.agents.child!.patch(
      `${childUrl}/${someone.json().data.id}`,
      { title: 'Hijacked' },
    );
    expect(response.statusCode).toBe(403);
  });

  it('lets a helper complete their own task but not delete it', async () => {
    const withLogins = await seedHousehold(test, { withLogins: ['helper'] });
    const helperUrl = `/api/v1/households/${withLogins.householdId}/tasks`;

    const task = await withLogins.admin.agent.post(helperUrl, {
      title: 'Wash the dishes',
      assigneeMemberId: withLogins.memberIds.helper,
    });
    const taskId = task.json().data.id;

    expect(
      (await withLogins.agents.helper!.post(`${helperUrl}/${taskId}/complete`, { completed: true }))
        .statusCode,
    ).toBe(200);
    expect((await withLogins.agents.helper!.delete(`${helperUrl}/${taskId}`)).statusCode).toBe(403);
  });
});

describe('tenant isolation', () => {
  it('cannot read, update or delete another household’s task', async () => {
    const other = await seedHousehold(test);
    const theirs = await other.admin.agent.post(
      `/api/v1/households/${other.householdId}/tasks`,
      { title: 'Their private task' },
    );
    const theirTaskId = theirs.json().data.id;

    expect((await home.admin.agent.get(`${url}/${theirTaskId}`)).statusCode).toBe(404);
    expect((await home.admin.agent.patch(`${url}/${theirTaskId}`, { title: 'x' })).statusCode).toBe(404);
    expect((await home.admin.agent.delete(`${url}/${theirTaskId}`)).statusCode).toBe(404);
    expect(
      (await home.admin.agent.post(`${url}/${theirTaskId}/complete`, { completed: true })).statusCode,
    ).toBe(404);
  });

  it('requires authentication', async () => {
    expect((await new Agent(test.app).get(url)).statusCode).toBe(401);
  });
});

describe('deletion', () => {
  it('soft-deletes so history is preserved', async () => {
    const created = await home.admin.agent.post(url, { title: 'Delete me' });
    const taskId = created.json().data.id;

    expect((await home.admin.agent.delete(`${url}/${taskId}`)).statusCode).toBe(204);
    expect((await home.admin.agent.get(`${url}/${taskId}`)).statusCode).toBe(404);

    const { tasks } = await import('../../db/schema/index.js');
    const { eq } = await import('drizzle-orm');
    const rows = await test.container.db.select().from(tasks).where(eq(tasks.id, taskId));
    // The row is still there, just marked deleted.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deletedAt).not.toBeNull();
  });

  it('writes an audit entry for every mutation', async () => {
    const created = await home.admin.agent.post(url, { title: 'Audited task' });
    const taskId = created.json().data.id;
    await home.admin.agent.patch(`${url}/${taskId}`, { priority: 'urgent' });
    await home.admin.agent.delete(`${url}/${taskId}`);

    const { auditLogs } = await import('../../db/schema/index.js');
    const { and, eq } = await import('drizzle-orm');
    const rows = await test.container.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'task'), eq(auditLogs.entityId, taskId)));

    expect(rows.map((r) => r.action).sort()).toEqual(['create', 'delete', 'update']);
  });
});
