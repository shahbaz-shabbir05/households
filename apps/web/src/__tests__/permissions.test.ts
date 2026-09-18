import { describe, expect, it } from 'vitest';
import { HOUSEHOLD_ROLES, type HouseholdRole } from '@hms/shared';
import { allows } from '../app/permissions.js';

/**
 * These decide what the UI *shows*. The server re-checks everything, so a bug
 * here is a usability bug, not a security hole — but a teen seeing a "Money"
 * tab that 403s on click is still a broken experience.
 */
describe('navigation visibility', () => {
  it('hides money and documents from teens and children', () => {
    for (const role of ['teen', 'child', 'helper'] as HouseholdRole[]) {
      expect(allows(role, 'viewMoney')).toBe(false);
      expect(allows(role, 'viewDocuments')).toBe(false);
    }
  });

  it('shows money to adults and admins', () => {
    expect(allows('adult', 'viewMoney')).toBe(true);
    expect(allows('admin', 'viewMoney')).toBe(true);
  });

  it('reserves member management for admins', () => {
    for (const role of HOUSEHOLD_ROLES) {
      expect(allows(role, 'manageMembers')).toBe(role === 'admin');
    }
  });

  it('lets everyone but a helper add a task', () => {
    for (const role of HOUSEHOLD_ROLES) {
      expect(allows(role, 'createTask')).toBe(role !== 'helper');
    }
  });
});
