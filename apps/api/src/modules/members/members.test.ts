import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTestApp, createTestApp, shutdownTestDatabase, type TestApp } from '../../test/setup.js';
import { seedHousehold, uniqueEmail } from '../../test/factories.js';

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

describe('members', () => {
  it('creates a member with no login at all', async () => {
    // Persona 5's veto: a helper or a small child must be assignable without
    // ever having an account (docs/02, docs/04).
    const { householdId, admin } = await seedHousehold(test);

    const response = await admin.agent.post(`/api/v1/households/${householdId}/members`, {
      displayName: 'Sana',
      role: 'helper',
      relationship: 'helper',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      displayName: 'Sana',
      role: 'helper',
      hasLogin: false,
      isActive: true,
    });
  });

  it('lists members of the household', async () => {
    const { householdId, admin } = await seedHousehold(test);
    const response = await admin.agent.get(`/api/v1/households/${householdId}/members`);

    expect(response.statusCode).toBe(200);
    // admin + adult + teen + child + helper
    expect(response.json().data).toHaveLength(5);
  });

  it('validates input and reports the offending field', async () => {
    const { householdId, admin } = await seedHousehold(test);
    const response = await admin.agent.post(`/api/v1/households/${householdId}/members`, {
      displayName: '',
      role: 'emperor',
    });

    expect(response.statusCode).toBe(400);
    const paths = response.json().error.details.map((d: { path: string }) => d.path);
    expect(paths).toContain('displayName');
    expect(paths).toContain('role');
  });

  it('ignores fields the caller is not allowed to set', async () => {
    const { householdId, admin } = await seedHousehold(test);
    const other = await seedHousehold(test);

    const response = await admin.agent.post(`/api/v1/households/${householdId}/members`, {
      displayName: 'Mass Assignment',
      role: 'adult',
      // Unknown keys are stripped at the boundary, so this cannot re-parent the row.
      householdId: other.householdId,
      isActive: false,
    });

    expect(response.statusCode).toBe(201);
    const created = response.json().data;
    expect(created.isActive).toBe(true);

    const inOriginal = await admin.agent.get(`/api/v1/households/${householdId}/members/${created.id}`);
    expect(inOriginal.statusCode).toBe(200);
  });
});

describe('member deactivation', () => {
  it('deactivates rather than destroying, preserving history', async () => {
    const { householdId, admin, memberIds } = await seedHousehold(test);

    expect(
      (await admin.agent.delete(`/api/v1/households/${householdId}/members/${memberIds.teen}`))
        .statusCode,
    ).toBe(204);

    const active = await admin.agent.get(`/api/v1/households/${householdId}/members`);
    expect(active.json().data.map((m: { id: string }) => m.id)).not.toContain(memberIds.teen);
  });

  it('refuses to remove the last admin', async () => {
    const { householdId, admin, memberIds } = await seedHousehold(test);

    // Self-removal is refused outright.
    const self = await admin.agent.delete(
      `/api/v1/households/${householdId}/members/${memberIds.admin}`,
    );
    expect(self.statusCode).toBe(400);

    // And demoting the only admin is refused too, which is the subtler case.
    const demote = await admin.agent.patch(
      `/api/v1/households/${householdId}/members/${memberIds.admin}`,
      { role: 'adult' },
    );
    expect(demote.statusCode).toBe(400);
    expect(demote.json().error.message).toMatch(/only admin/i);
  });
});

describe('authorization', () => {
  it('stops a teen from managing members or assigning roles', async () => {
    const { householdId, memberIds, agents } = await seedHousehold(test, { withLogins: ['teen'] });
    const teen = agents.teen!;

    const created = await teen.post(`/api/v1/households/${householdId}/members`, {
      displayName: 'Nope',
      role: 'adult',
    });
    expect(created.statusCode).toBe(403);

    const promoted = await teen.patch(
      `/api/v1/households/${householdId}/members/${memberIds.teen}`,
      { role: 'admin' },
    );
    expect(promoted.statusCode).toBe(403);
  });

  it('lets a teen correct their own profile but not someone else’s', async () => {
    const { householdId, memberIds, agents } = await seedHousehold(test, { withLogins: ['teen'] });
    const teen = agents.teen!;

    const own = await teen.patch(`/api/v1/households/${householdId}/members/${memberIds.teen}`, {
      phone: '0300-1234567',
    });
    expect(own.statusCode).toBe(200);

    const other = await teen.patch(`/api/v1/households/${householdId}/members/${memberIds.child}`, {
      phone: '0300-7654321',
    });
    expect(other.statusCode).toBe(403);
  });

  it('shows a helper only their own record', async () => {
    const { householdId, memberIds, agents } = await seedHousehold(test, { withLogins: ['helper'] });

    const response = await agents.helper!.get(`/api/v1/households/${householdId}/members`);
    expect(response.statusCode).toBe(200);
    expect(response.json().data.map((m: { id: string }) => m.id)).toEqual([memberIds.helper]);
  });
});

describe('tenant isolation', () => {
  it('returns 404 — not 403 — for a household the user does not belong to', async () => {
    // 403 would confirm the household exists, which is an enumeration oracle
    // (docs/06).
    const a = await seedHousehold(test, { name: 'Household A' });
    const b = await seedHousehold(test, { name: 'Household B' });

    const response = await a.admin.agent.get(`/api/v1/households/${b.householdId}/members`);
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('cannot read a member belonging to another household', async () => {
    const a = await seedHousehold(test);
    const b = await seedHousehold(test);

    // Using household A's id in the path with household B's member id: the
    // repository scopes by household, so the row is simply not found.
    const response = await a.admin.agent.get(
      `/api/v1/households/${a.householdId}/members/${b.memberIds.adult}`,
    );
    expect(response.statusCode).toBe(404);
  });

  it('cannot modify a member belonging to another household', async () => {
    const a = await seedHousehold(test);
    const b = await seedHousehold(test);

    const patched = await a.admin.agent.patch(
      `/api/v1/households/${a.householdId}/members/${b.memberIds.adult}`,
      { displayName: 'Hijacked' },
    );
    expect(patched.statusCode).toBe(404);

    const deleted = await a.admin.agent.delete(
      `/api/v1/households/${a.householdId}/members/${b.memberIds.adult}`,
    );
    expect(deleted.statusCode).toBe(404);

    // And the target is untouched.
    const check = await b.admin.agent.get(
      `/api/v1/households/${b.householdId}/members/${b.memberIds.adult}`,
    );
    expect(check.json().data.displayName).not.toBe('Hijacked');
  });

  it('requires authentication on every household route', async () => {
    const { householdId } = await seedHousehold(test);
    const { Agent } = await import('../../test/setup.js');
    const anonymous = new Agent(test.app);

    for (const url of [
      `/api/v1/households/${householdId}/members`,
      `/api/v1/households/${householdId}/dashboard`,
      `/api/v1/households/${householdId}`,
    ]) {
      expect((await anonymous.get(url)).statusCode).toBe(401);
    }
  });
});

describe('invites', () => {
  it('binds a login to an existing member, preserving the member row', async () => {
    const { householdId, memberIds, agents } = await seedHousehold(test, { withLogins: ['adult'] });

    const response = await agents.adult!.get(`/api/v1/me`);
    expect(response.statusCode).toBe(200);

    const households = response.json().data.households;
    expect(households).toHaveLength(1);
    // Same member id as before the invite: history stays attached (docs/04).
    expect(households[0].memberId).toBe(memberIds.adult);
    expect(households[0].role).toBe('adult');
  });

  it('refuses a second invite for a member who can already sign in', async () => {
    const { householdId, memberIds, admin } = await seedHousehold(test, { withLogins: ['adult'] });

    const response = await admin.agent.post(`/api/v1/households/${householdId}/invites`, {
      memberId: memberIds.adult,
      email: uniqueEmail(),
    });
    expect(response.statusCode).toBe(409);
  });

  it('rejects an invalid or expired invite token', async () => {
    const { admin } = await seedHousehold(test);
    const response = await admin.agent.post('/api/v1/invites/accept', {
      token: 'not-a-real-invite-token-value',
    });
    expect(response.statusCode).toBe(400);
  });

  it('requires the inviter to have verified their own email', async () => {
    const { registerUser } = await import('../../test/factories.js');
    const unverified = await registerUser(test, 'Unverified Admin');

    const created = await unverified.agent.post('/api/v1/households', { name: 'New Household' });
    const householdId = created.json().data.id;

    const member = await unverified.agent.post(`/api/v1/households/${householdId}/members`, {
      displayName: 'Invitee',
      role: 'adult',
    });

    const response = await unverified.agent.post(`/api/v1/households/${householdId}/invites`, {
      memberId: member.json().data.id,
      email: uniqueEmail(),
    });
    expect(response.statusCode).toBe(403);
  });
});
