import type { HouseholdRole } from '@hms/shared';

/**
 * Everything a service needs to know about who is acting, resolved once per
 * request. Services take this as their first argument, so audit entries,
 * policy checks and timezone-sensitive maths all read from one source of truth
 * (docs/05).
 */
export interface RequestContext {
  requestId: string;
  user: { id: string; email: string; displayName: string };
  household: {
    id: string;
    timezone: string;
    currency: string;
    locale: string;
    weekStartsOn: 0 | 1;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
  };
  member: { id: string; role: HouseholdRole; displayName: string };
  ip: string | null;
  userAgent: string | null;
}

/** A context without a household, for routes that precede household selection. */
export interface UserContext {
  requestId: string;
  user: { id: string; email: string; displayName: string };
  ip: string | null;
  userAgent: string | null;
}
