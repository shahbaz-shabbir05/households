/**
 * The dashboard contract (docs/03, docs/06).
 *
 * The dashboard is the product, so it is the one place we break strict REST
 * resource-orientation: a phone on a slow connection should make one request
 * and get one coherent snapshot, not eight racing ones.
 *
 * Modules contribute items rather than the dashboard importing each module's
 * data access. That keeps the monolith modular: adding bills in phase 4 means
 * registering a contributor, not editing this file.
 */

import type { CivilDate, EntityType, Priority } from '@hms/shared';
import type { RequestContext } from '../../core/request-context.js';
import type { DbExecutor } from '../../db/client.js';

/** A single actionable line on the dashboard. */
export interface DashboardItem {
  id: string;
  entityType: EntityType;
  title: string;
  subtitle?: string | null;
  /** The civil date this item is due/scheduled for, in household time. */
  date: CivilDate;
  /** `HH:MM` when the item is time-specific; absent for all-day items. */
  time?: string | null;
  priority: Priority;
  /** Rendered as a red "overdue" treatment and ranked first. */
  isOverdue: boolean;
  assigneeMemberId?: string | null;
  assigneeName?: string | null;
  /** Money, where the item has an amount (a bill, an expense). */
  amountMinor?: number | null;
  /** The action the row offers inline, e.g. `task:complete`. */
  quickAction?: string | null;
}

export interface DashboardWindow {
  today: CivilDate;
  weekFrom: CivilDate;
  weekTo: CivilDate;
}

/**
 * Implemented by each module that has something to say about "today".
 * Contributors must return items already scoped to the household and filtered
 * by what the actor may see — the dashboard does not re-check permissions for
 * them, because only the owning module knows its own visibility rules.
 */
export interface DashboardContributor {
  readonly name: string;
  collect(
    db: DbExecutor,
    ctx: RequestContext,
    window: DashboardWindow,
  ): Promise<DashboardItem[]>;
}

export interface DashboardSummary {
  generatedAt: string;
  window: DashboardWindow;
  /** Overdue and urgent, ranked first — the reason the user opened the app. */
  needsAttention: DashboardItem[];
  today: DashboardItem[];
  thisWeek: DashboardItem[];
  counts: {
    needsAttention: number;
    today: number;
    thisWeek: number;
    unreadNotifications: number;
  };
  household: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    memberCount: number;
  };
  /**
   * Which quick-add actions to offer, filtered by the actor's permissions, so
   * the UI never shows a button the server will refuse.
   */
  quickActions: string[];
}
