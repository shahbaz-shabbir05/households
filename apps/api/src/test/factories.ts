/**
 * Test data builders.
 *
 * `seedHousehold` creates a household containing a member in every role, so a
 * permission case costs one line. That is what makes the mandatory
 * cross-tenant and wrong-role batteries (docs/12) cheap enough to actually
 * write for every resource.
 */

import type { HouseholdRole } from '@hms/shared';
import { Agent, type TestApp } from './setup.js';

let counter = 0;
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}${counter}.${Date.now()}@example.test`;
}

export const TEST_PASSWORD = 'correct-horse-battery-staple';

export interface RegisteredUser {
  agent: Agent;
  email: string;
  userId: string;
}

export async function registerUser(test: TestApp, displayName = 'Test User'): Promise<RegisteredUser> {
  const agent = new Agent(test.app);
  const email = uniqueEmail();

  const response = await agent.post('/api/v1/auth/register', {
    email,
    password: TEST_PASSWORD,
    displayName,
  });
  if (response.statusCode !== 201) {
    throw new Error(`registerUser failed: ${response.statusCode} ${response.body}`);
  }

  return { agent, email, userId: response.json().data.user.id };
}

export async function verifyEmail(test: TestApp, email: string, agent: Agent): Promise<void> {
  const mail = test.mailer.lastTo(email);
  const token = /token=([\w-]+)/.exec(mail?.text ?? '')?.[1];
  if (!token) throw new Error(`No verification token found in mail to ${email}`);
  await agent.post('/api/v1/auth/email/verify', { token });
}

export interface SeededHousehold {
  householdId: string;
  admin: RegisteredUser;
  /** Member ids by role, including roles with no login attached. */
  memberIds: Record<HouseholdRole, string>;
  /** Signed-in agents for roles that were given a login. */
  agents: Partial<Record<HouseholdRole, Agent>>;
}

/**
 * Creates a household with an admin, plus a member for every other role.
 * By default only the admin has a login; pass roles to `withLogins` to invite
 * and accept for those members too.
 */
export async function seedHousehold(
  test: TestApp,
  options: { withLogins?: HouseholdRole[]; name?: string } = {},
): Promise<SeededHousehold> {
  const admin = await registerUser(test, 'Ayesha Admin');
  await verifyEmail(test, admin.email, admin.agent);

  const created = await admin.agent.post('/api/v1/households', {
    name: options.name ?? 'Test Household',
    currency: 'PKR',
    timezone: 'Asia/Karachi',
    countryCode: 'PK',
  });
  if (created.statusCode !== 201) {
    throw new Error(`seedHousehold failed: ${created.statusCode} ${created.body}`);
  }

  const household = created.json().data;
  const memberIds: Record<HouseholdRole, string> = {
    admin: household.memberId,
    adult: '',
    teen: '',
    child: '',
    helper: '',
  };

  for (const role of ['adult', 'teen', 'child', 'helper'] as const) {
    const response = await admin.agent.post(`/api/v1/households/${household.id}/members`, {
      displayName: `${role} member`,
      role,
      relationship: role === 'adult' ? 'spouse' : role === 'helper' ? 'helper' : 'child',
    });
    if (response.statusCode !== 201) {
      throw new Error(`Creating ${role} member failed: ${response.statusCode} ${response.body}`);
    }
    memberIds[role] = response.json().data.id;
  }

  const agents: Partial<Record<HouseholdRole, Agent>> = { admin: admin.agent };

  for (const role of options.withLogins ?? []) {
    if (role === 'admin') continue;
    agents[role] = await attachLogin(test, household.id, memberIds[role], admin.agent);
  }

  return { householdId: household.id, admin, memberIds, agents };
}

/** Invites a member, registers a user, accepts — i.e. the real invite flow. */
export async function attachLogin(
  test: TestApp,
  householdId: string,
  memberId: string,
  adminAgent: Agent,
): Promise<Agent> {
  const email = uniqueEmail('member');

  const invited = await adminAgent.post(`/api/v1/households/${householdId}/invites`, {
    memberId,
    email,
  });
  if (invited.statusCode !== 202) {
    throw new Error(`Invite failed: ${invited.statusCode} ${invited.body}`);
  }

  const mail = test.mailer.lastTo(email);
  const token = /accept-invite\?token=([\w-]+)/.exec(mail?.text ?? '')?.[1];
  if (!token) throw new Error(`No invite token found in mail to ${email}`);

  const agent = new Agent(test.app);
  const registered = await agent.post('/api/v1/auth/register', {
    email,
    password: TEST_PASSWORD,
    displayName: 'Invited Member',
  });
  if (registered.statusCode !== 201) {
    throw new Error(`Invitee registration failed: ${registered.body}`);
  }

  const accepted = await agent.post('/api/v1/invites/accept', { token });
  if (accepted.statusCode !== 200) {
    throw new Error(`Accepting invite failed: ${accepted.statusCode} ${accepted.body}`);
  }
  return agent;
}
