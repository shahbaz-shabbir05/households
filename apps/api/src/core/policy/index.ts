/**
 * The authorization entry point. Every permission decision in the application
 * goes through `can` / `assertCan` — there is no second place (docs/07).
 */

import { ROLE_RANK, type DocumentVisibility, type HouseholdRole } from '@hms/shared';
import { ForbiddenError } from '../errors.js';
import { PERMISSION_MATRIX, type Action, type Scope } from './actions.js';

export { ACTIONS, PERMISSION_MATRIX, assertMatrixIsComplete } from './actions.js';
export type { Action, Scope } from './actions.js';

/** The minimum an actor must carry for a decision; `RequestContext` satisfies it. */
export interface PolicyActor {
  member: { id: string; role: HouseholdRole };
}

/**
 * The shape of a resource, as far as authorization is concerned. Any subset
 * may be present; missing fields simply cannot satisfy a narrowed scope.
 */
export interface PolicyResource {
  /** The member a record is *about* (a medicine's patient, a document's owner). */
  memberId?: string | null;
  /** The member a record is *assigned to* (a task's doer). */
  assigneeMemberId?: string | null;
  /** The member who created it. */
  createdByMemberId?: string | null;
  /** Row-level narrowing for sensitive records. */
  visibility?: DocumentVisibility | null;
}

/**
 * The seam that keeps DB-backed custom roles possible without rewriting call
 * sites (docs/16 §B.6). MVP ships exactly one implementation.
 */
export interface PermissionProvider {
  scopeFor(role: HouseholdRole, action: Action): Scope;
}

export const staticRoleProvider: PermissionProvider = {
  scopeFor(role, action) {
    return PERMISSION_MATRIX[action]?.[role] ?? 'none';
  },
};

let provider: PermissionProvider = staticRoleProvider;

export function setPermissionProvider(next: PermissionProvider): void {
  provider = next;
}

export function scopeFor(actor: PolicyActor, action: Action): Scope {
  return provider.scopeFor(actor.member.role, action);
}

/**
 * Decides whether `actor` may perform `action`, optionally on a specific
 * resource.
 *
 * Calling without a resource answers the *action-level* question ("may this
 * role create expenses at all?"). Note that a scope of `own`/`assigned` returns
 * true there — it means "yes, for some records" — so any handler that loads a
 * specific record must call again *with* it. Repository-level household scoping
 * means a resource from another household never reaches this function.
 */
export function can(actor: PolicyActor, action: Action, resource?: PolicyResource): boolean {
  const scope = scopeFor(actor, action);
  if (scope === 'none') return false;
  if (!resource) return true;

  if (!passesVisibility(actor, resource)) return false;
  if (scope === 'all') return true;

  const me = actor.member.id;
  if (scope === 'assigned') return resource.assigneeMemberId === me;

  // 'own': about me, assigned to me, or created by me.
  return (
    resource.memberId === me ||
    resource.assigneeMemberId === me ||
    resource.createdByMemberId === me
  );
}

/**
 * Row-level visibility, applied *after* the role check and independently of it.
 * A record marked `admins` is invisible to an adult even though the adult's
 * role-level scope is `all`.
 */
function passesVisibility(actor: PolicyActor, resource: PolicyResource): boolean {
  switch (resource.visibility) {
    case undefined:
    case null:
    case 'household':
      return true;
    case 'adults':
      return ROLE_RANK[actor.member.role] >= ROLE_RANK.adult;
    case 'admins':
      return actor.member.role === 'admin';
    case 'owner':
      return resource.memberId === actor.member.id || actor.member.role === 'admin';
    default:
      // An unknown visibility must fail closed, never open.
      return false;
  }
}

export function assertCan(actor: PolicyActor, action: Action, resource?: PolicyResource): void {
  if (!can(actor, action, resource)) {
    throw new ForbiddenError(`You do not have permission to ${describeAction(action)}`, {
      action,
      role: actor.member.role,
    });
  }
}

export function hasRoleAtLeast(actor: PolicyActor, role: HouseholdRole): boolean {
  return ROLE_RANK[actor.member.role] >= ROLE_RANK[role];
}

/** Turns `task:complete` into "complete tasks" for a readable error message. */
function describeAction(action: Action): string {
  const [subject, verb] = action.split(':');
  return `${verb} ${subject?.replace(/_/g, ' ')}s`;
}

/**
 * The set of actions an actor may take at all, sent to the client so navigation
 * and buttons match what the server will actually permit. A convenience for the
 * UI — never the security boundary.
 */
export function grantedActions(actor: PolicyActor): Action[] {
  return (Object.keys(PERMISSION_MATRIX) as Action[]).filter(
    (action) => scopeFor(actor, action) !== 'none',
  );
}
