import { describe, expect, it } from 'vitest';
import { HOUSEHOLD_ROLES, type HouseholdRole } from '@hms/shared';
import { ACTIONS, assertCan, assertMatrixIsComplete, can, grantedActions, type Action } from './index.js';
import { ForbiddenError } from '../errors.js';

const actor = (role: HouseholdRole, id = 'member-self') => ({ member: { id, role } });

describe('permission matrix', () => {
  it('covers every action for every role', () => {
    expect(() => assertMatrixIsComplete()).not.toThrow();
  });

  it('has no action outside the declared list', () => {
    expect(new Set(ACTIONS).size).toBe(ACTIONS.length);
  });
});

describe('role boundaries that matter', () => {
  /**
   * Persona 3's veto (docs/02): a teenager must not reach household finances or
   * documents. These are security cases, not preferences.
   */
  const financeActions: Action[] = [
    'expense:read', 'expense:create', 'bill:read', 'bill:pay', 'budget:read', 'report:read',
  ];
  const documentActions: Action[] = ['document:read', 'document:create', 'document:delete'];

  it.each(financeActions)('denies a teen %s', (action) => {
    expect(can(actor('teen'), action)).toBe(false);
  });

  it.each(financeActions)('denies a child %s', (action) => {
    expect(can(actor('child'), action)).toBe(false);
  });

  it.each(documentActions)('denies a teen %s', (action) => {
    expect(can(actor('teen'), action)).toBe(false);
  });

  it.each([...financeActions, ...documentActions])('allows an adult %s', (action) => {
    // `document:delete` is admin-only; everything else an adult may do.
    const expected = action !== 'document:delete';
    expect(can(actor('adult'), action)).toBe(expected);
  });

  it('gives a helper nothing but their assigned tasks', () => {
    const helper = actor('helper');
    const permitted = grantedActions(helper);
    expect(permitted).toEqual(
      expect.arrayContaining(['task:read', 'task:update', 'task:complete']),
    );
    expect(permitted).not.toContain('expense:read');
    expect(permitted).not.toContain('document:read');
    expect(permitted).not.toContain('inventory:read');
  });

  it('reserves role assignment and household deletion for admins', () => {
    for (const role of HOUSEHOLD_ROLES) {
      const expected = role === 'admin';
      expect(can(actor(role), 'role:assign')).toBe(expected);
      expect(can(actor(role), 'household:delete')).toBe(expected);
      expect(can(actor(role), 'member:create')).toBe(expected);
    }
  });
});

describe('object-level scopes', () => {
  it('lets a helper act only on tasks assigned to them', () => {
    const helper = actor('helper', 'm-helper');
    expect(can(helper, 'task:complete', { assigneeMemberId: 'm-helper' })).toBe(true);
    expect(can(helper, 'task:complete', { assigneeMemberId: 'm-other' })).toBe(false);
  });

  it('lets a child update their own task but not a sibling’s', () => {
    const child = actor('child', 'm-child');
    expect(can(child, 'task:update', { assigneeMemberId: 'm-child' })).toBe(true);
    expect(can(child, 'task:update', { createdByMemberId: 'm-child' })).toBe(true);
    expect(can(child, 'task:update', { assigneeMemberId: 'm-sibling' })).toBe(false);
  });

  it('lets an adult act on anyone’s task', () => {
    expect(can(actor('adult'), 'task:update', { assigneeMemberId: 'someone-else' })).toBe(true);
  });

  it('lets a teen read their own health record but not another member’s', () => {
    const teen = actor('teen', 'm-teen');
    expect(can(teen, 'health:read', { memberId: 'm-teen' })).toBe(true);
    expect(can(teen, 'health:read', { memberId: 'm-parent' })).toBe(false);
  });

  it('answers the action-level question without a resource', () => {
    // 'own' means "yes, for some records" — handlers must re-check with the row.
    expect(can(actor('child'), 'task:update')).toBe(true);
    expect(can(actor('child'), 'expense:read')).toBe(false);
  });
});

describe('visibility narrows further than role', () => {
  it('hides an admins-only document from an adult whose role scope is "all"', () => {
    expect(can(actor('adult'), 'document:read', { visibility: 'admins' })).toBe(false);
    expect(can(actor('admin'), 'document:read', { visibility: 'admins' })).toBe(true);
  });

  it('restricts an owner-only document to its subject, plus admins', () => {
    const adult = actor('adult', 'm-adult');
    expect(can(adult, 'document:read', { visibility: 'owner', memberId: 'm-adult' })).toBe(true);
    expect(can(adult, 'document:read', { visibility: 'owner', memberId: 'm-other' })).toBe(false);
    expect(
      can(actor('admin', 'm-admin'), 'document:read', { visibility: 'owner', memberId: 'm-other' }),
    ).toBe(true);
  });

  it('fails closed on an unrecognised visibility', () => {
    const resource = { visibility: 'something-new' as never };
    expect(can(actor('admin'), 'document:read', resource)).toBe(false);
  });
});

describe('assertCan', () => {
  it('throws a ForbiddenError naming the action', () => {
    expect(() => assertCan(actor('teen'), 'expense:create')).toThrow(ForbiddenError);
    try {
      assertCan(actor('teen'), 'expense:create');
    } catch (error) {
      expect((error as ForbiddenError).statusCode).toBe(403);
      expect((error as ForbiddenError).message).toMatch(/create expenses/);
    }
  });

  it('does not throw when permitted', () => {
    expect(() => assertCan(actor('adult'), 'expense:create')).not.toThrow();
  });
});
