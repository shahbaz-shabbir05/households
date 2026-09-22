/**
 * Client-side permission hints.
 *
 * These decide what to *show*. They are never the security boundary — the
 * server re-checks every action, and a hidden button is a convenience, not a
 * control (docs/07).
 */

import { ROLE_RANK, type HouseholdRole } from '@hms/shared';

export type UiCapability =
  | 'manageMembers'
  | 'manageHousehold'
  | 'viewMoney'
  | 'viewDocuments'
  | 'createTask'
  | 'createEvent'
  | 'createReminder'
  | 'viewShopping';

const RULES: Record<UiCapability, (role: HouseholdRole) => boolean> = {
  manageMembers: (role) => role === 'admin',
  manageHousehold: (role) => role === 'admin',
  viewMoney: (role) => ROLE_RANK[role] >= ROLE_RANK.adult,
  viewDocuments: (role) => ROLE_RANK[role] >= ROLE_RANK.adult,
  createTask: (role) => role !== 'helper',
  createEvent: (role) => ROLE_RANK[role] >= ROLE_RANK.teen,
  createReminder: (role) => role !== 'helper',
  viewShopping: (role) => role !== 'helper',
};

export function allows(role: HouseholdRole, capability: UiCapability): boolean {
  return RULES[capability](role);
}
