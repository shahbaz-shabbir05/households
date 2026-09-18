/**
 * The closed set of things anyone can do, and the role matrix that decides
 * who may do them.
 *
 * This is the single source of authorization truth (docs/07). It lives in code
 * rather than in a database because five roles cover every household, and a
 * static matrix is reviewable in a diff and impossible for a user to
 * misconfigure into a security hole. The `PermissionProvider` seam in
 * `index.ts` is what keeps DB-backed custom roles possible later.
 */

import { HOUSEHOLD_ROLES, type HouseholdRole } from '@hms/shared';

export const ACTIONS = [
  // Household administration
  'household:read', 'household:update', 'household:delete', 'household:export',
  'member:read', 'member:create', 'member:update', 'member:delete', 'member:invite',
  'role:assign',
  'audit:read',

  // Work
  'task:read', 'task:create', 'task:update', 'task:delete', 'task:complete',
  'event:read', 'event:create', 'event:update', 'event:delete',
  'reminder:read', 'reminder:create', 'reminder:update', 'reminder:delete',

  // Shopping
  'inventory:read', 'inventory:create', 'inventory:update', 'inventory:delete',
  'shopping:read', 'shopping:create', 'shopping:update', 'shopping:delete',

  // Money
  'expense:read', 'expense:create', 'expense:update', 'expense:delete',
  'bill:read', 'bill:create', 'bill:update', 'bill:delete', 'bill:pay',
  'budget:read', 'budget:manage',
  'report:read',

  // Health
  'health:read', 'health:create', 'health:update', 'health:delete',

  // Things
  'asset:read', 'asset:manage',
  'maintenance:read', 'maintenance:manage',
  'contact:read', 'contact:manage',
  'note:read', 'note:manage',

  // Sensitive
  'document:read', 'document:create', 'document:update', 'document:delete',
  'attachment:upload',
] as const;

export type Action = (typeof ACTIONS)[number];

/**
 * How widely a role may act:
 *   all      — every record in the household
 *   own      — only records about, or created by, this member
 *   assigned — only records assigned to this member (a helper's task list)
 *   none     — not at all
 */
export type Scope = 'all' | 'own' | 'assigned' | 'none';

type Matrix = Record<Action, Record<HouseholdRole, Scope>>;

const N: Record<HouseholdRole, Scope> = {
  admin: 'none', adult: 'none', teen: 'none', child: 'none', helper: 'none',
};

const row = (over: Partial<Record<HouseholdRole, Scope>>): Record<HouseholdRole, Scope> => ({
  ...N,
  ...over,
});

/**
 * The matrix. Read it as: for this action, what may each role reach?
 *
 * The deliberate shape of it: children and teens live in tasks and the
 * calendar; money and documents are adult-and-above; helpers see only what is
 * assigned to them and nothing else at all.
 */
export const PERMISSION_MATRIX: Matrix = {
  'household:read':   row({ admin: 'all', adult: 'all', teen: 'all', child: 'all', helper: 'all' }),
  'household:update': row({ admin: 'all' }),
  'household:delete': row({ admin: 'all' }),
  'household:export': row({ admin: 'all' }),

  'member:read':   row({ admin: 'all', adult: 'all', teen: 'all', child: 'all', helper: 'own' }),
  'member:create': row({ admin: 'all' }),
  // Adults may correct their own profile; only admins may edit anyone else's.
  'member:update': row({ admin: 'all', adult: 'own', teen: 'own', child: 'own', helper: 'own' }),
  'member:delete': row({ admin: 'all' }),
  'member:invite': row({ admin: 'all' }),
  'role:assign':   row({ admin: 'all' }),
  'audit:read':    row({ admin: 'all' }),

  'task:read':     row({ admin: 'all', adult: 'all', teen: 'all', child: 'all', helper: 'assigned' }),
  'task:create':   row({ admin: 'all', adult: 'all', teen: 'all', child: 'all' }),
  'task:update':   row({ admin: 'all', adult: 'all', teen: 'own', child: 'own', helper: 'assigned' }),
  'task:delete':   row({ admin: 'all', adult: 'all', teen: 'own', child: 'own' }),
  'task:complete': row({ admin: 'all', adult: 'all', teen: 'own', child: 'own', helper: 'assigned' }),

  'event:read':   row({ admin: 'all', adult: 'all', teen: 'all', child: 'all' }),
  'event:create': row({ admin: 'all', adult: 'all', teen: 'all' }),
  'event:update': row({ admin: 'all', adult: 'all', teen: 'own' }),
  'event:delete': row({ admin: 'all', adult: 'all', teen: 'own' }),

  'reminder:read':   row({ admin: 'all', adult: 'all', teen: 'own', child: 'own', helper: 'own' }),
  'reminder:create': row({ admin: 'all', adult: 'all', teen: 'all', child: 'all' }),
  'reminder:update': row({ admin: 'all', adult: 'all', teen: 'own', child: 'own' }),
  'reminder:delete': row({ admin: 'all', adult: 'all', teen: 'own', child: 'own' }),

  'inventory:read':   row({ admin: 'all', adult: 'all', teen: 'all', child: 'all' }),
  'inventory:create': row({ admin: 'all', adult: 'all', teen: 'all' }),
  'inventory:update': row({ admin: 'all', adult: 'all', teen: 'all' }),
  'inventory:delete': row({ admin: 'all', adult: 'all' }),

  // Teens can add to the shopping list — a low-risk, high-participation action.
  'shopping:read':   row({ admin: 'all', adult: 'all', teen: 'all', child: 'all' }),
  'shopping:create': row({ admin: 'all', adult: 'all', teen: 'all' }),
  'shopping:update': row({ admin: 'all', adult: 'all', teen: 'all' }),
  'shopping:delete': row({ admin: 'all', adult: 'all' }),

  'expense:read':   row({ admin: 'all', adult: 'all' }),
  'expense:create': row({ admin: 'all', adult: 'all' }),
  'expense:update': row({ admin: 'all', adult: 'all' }),
  'expense:delete': row({ admin: 'all', adult: 'all' }),

  'bill:read':   row({ admin: 'all', adult: 'all' }),
  'bill:create': row({ admin: 'all', adult: 'all' }),
  'bill:update': row({ admin: 'all', adult: 'all' }),
  'bill:delete': row({ admin: 'all', adult: 'all' }),
  'bill:pay':    row({ admin: 'all', adult: 'all' }),

  'budget:read':   row({ admin: 'all', adult: 'all' }),
  'budget:manage': row({ admin: 'all', adult: 'all' }),
  'report:read':   row({ admin: 'all', adult: 'all' }),

  // Everyone may see their own health records; only adults see other people's.
  'health:read':   row({ admin: 'all', adult: 'all', teen: 'own', child: 'own' }),
  'health:create': row({ admin: 'all', adult: 'all' }),
  'health:update': row({ admin: 'all', adult: 'all' }),
  'health:delete': row({ admin: 'all', adult: 'all' }),

  'asset:read':         row({ admin: 'all', adult: 'all', teen: 'all' }),
  'asset:manage':       row({ admin: 'all', adult: 'all' }),
  'maintenance:read':   row({ admin: 'all', adult: 'all', teen: 'all' }),
  'maintenance:manage': row({ admin: 'all', adult: 'all' }),
  'contact:read':       row({ admin: 'all', adult: 'all', teen: 'all', child: 'all' }),
  'contact:manage':     row({ admin: 'all', adult: 'all' }),
  'note:read':          row({ admin: 'all', adult: 'all', teen: 'all' }),
  'note:manage':        row({ admin: 'all', adult: 'all' }),

  // Documents are the most sensitive data in the product: adults and above only,
  // and then further narrowed per-document by `visibility` (docs/07).
  'document:read':   row({ admin: 'all', adult: 'all' }),
  'document:create': row({ admin: 'all', adult: 'all' }),
  'document:update': row({ admin: 'all', adult: 'all' }),
  'document:delete': row({ admin: 'all' }),

  'attachment:upload': row({ admin: 'all', adult: 'all', teen: 'all' }),
};

/** Guards against a role being added to the enum but forgotten in the matrix. */
export function assertMatrixIsComplete(): void {
  for (const action of ACTIONS) {
    const scopes = PERMISSION_MATRIX[action];
    for (const role of HOUSEHOLD_ROLES) {
      if (scopes[role] === undefined) {
        throw new Error(`Permission matrix is missing ${action} for role ${role}`);
      }
    }
  }
}
