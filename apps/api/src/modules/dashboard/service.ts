/**
 * Dashboard aggregation.
 *
 * Ranking, not configurability, is how the dashboard "prioritises things that
 * actually require attention" (docs/16 §B.5): overdue first, then urgency, then
 * time of day. Sections that are empty are simply absent from the UI.
 */

import { and, count, eq, isNull } from 'drizzle-orm';
import type { CivilDate } from '@hms/shared';
import { householdMembers, households, notifications } from '../../db/schema/index.js';
import type { Database } from '../../db/client.js';
import { NotFoundError } from '../../core/errors.js';
import { can, type Action } from '../../core/policy/index.js';
import type { RequestContext } from '../../core/request-context.js';
import { todayIn, weekWindow } from '../../core/time.js';
import type {
  DashboardContributor,
  DashboardItem,
  DashboardSummary,
  DashboardWindow,
} from './types.js';

export * from './types.js';

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 } as const;

/** Quick-add actions offered on the dashboard, each gated by a permission. */
const QUICK_ACTIONS: Array<{ key: string; action: Action }> = [
  { key: 'expense', action: 'expense:create' },
  { key: 'grocery', action: 'shopping:create' },
  { key: 'task', action: 'task:create' },
  { key: 'reminder', action: 'reminder:create' },
  { key: 'event', action: 'event:create' },
  { key: 'bill', action: 'bill:create' },
  { key: 'appointment', action: 'health:create' },
  { key: 'medicine', action: 'health:create' },
  { key: 'maintenance', action: 'maintenance:manage' },
];

export class DashboardService {
  private readonly contributors: DashboardContributor[] = [];

  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Called at wiring time by each module that has dashboard content. */
  register(contributor: DashboardContributor): this {
    this.contributors.push(contributor);
    return this;
  }

  /**
   * Returns the snapshot plus any contributor failures for *this* request.
   *
   * The failures used to accumulate on the instance, which is a container
   * singleton shared by every concurrent request — one household's failure
   * could be drained and logged under another household's request id.
   */
  async summary(ctx: RequestContext): Promise<{
    summary: DashboardSummary;
    failures: Array<{ contributor: string; error: string }>;
  }> {
    const now = this.now();
    const today = todayIn(ctx.household.timezone, now);
    const week = weekWindow(ctx.household.timezone, ctx.household.weekStartsOn, now);
    const window: DashboardWindow = { today, weekFrom: week.from, weekTo: week.to };

    const [household, memberCount, unread, items] = await Promise.all([
      this.db.query.households.findFirst({
        where: and(eq(households.id, ctx.household.id), isNull(households.deletedAt)),
        columns: { id: true, name: true, currency: true, timezone: true },
      }),
      this.countMembers(ctx.household.id),
      this.countUnreadNotifications(ctx.member.id),
      this.collectItems(ctx, window),
    ]);

    if (!household) throw new NotFoundError('Household');
    const { items: collected, failures } = items;

    const needsAttention = collected.filter((i) => i.isOverdue || i.priority === 'urgent').sort(rank);
    const attentionIds = new Set(needsAttention.map((i) => i.id));
    const todayItems = collected.filter((i) => !attentionIds.has(i.id) && i.date === today).sort(rank);
    const laterIds = new Set([...attentionIds, ...todayItems.map((i) => i.id)]);
    const thisWeek = collected
      .filter((i) => !laterIds.has(i.id) && i.date > today && i.date <= window.weekTo)
      .sort(rank);

    const summary: DashboardSummary = {
      generatedAt: now.toISOString(),
      window,
      needsAttention,
      today: todayItems,
      thisWeek,
      counts: {
        needsAttention: needsAttention.length,
        today: todayItems.length,
        thisWeek: thisWeek.length,
        unreadNotifications: unread,
      },
      household: { ...household, memberCount },
      quickActions: QUICK_ACTIONS.filter((qa) => can(ctx, qa.action)).map((qa) => qa.key),
    };

    return { summary, failures };
  }

  /**
   * Runs every contributor. One failing module must not blank the whole
   * dashboard, so failures are isolated and reported as a missing section
   * rather than a 500.
   */
  private async collectItems(
    ctx: RequestContext,
    window: DashboardWindow,
  ): Promise<{ items: DashboardItem[]; failures: Array<{ contributor: string; error: string }> }> {
    const results = await Promise.allSettled(
      this.contributors.map((c) => c.collect(this.db, ctx, window)),
    );

    const items: DashboardItem[] = [];
    const failures: Array<{ contributor: string; error: string }> = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        items.push(...result.value);
      } else {
        failures.push({
          contributor: this.contributors[index]?.name ?? 'unknown',
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
    return { items, failures };
  }

  private async countMembers(householdId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, householdId),
          eq(householdMembers.isActive, true),
          isNull(householdMembers.deletedAt),
        ),
      );
    return row?.value ?? 0;
  }

  private async countUnreadNotifications(memberId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.memberId, memberId), isNull(notifications.readAt)));
    return row?.value ?? 0;
  }
}

/** Overdue first, then urgency, then earlier dates, then earlier times. */
function rank(a: DashboardItem, b: DashboardItem): number {
  if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (byPriority !== 0) return byPriority;
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (a.time ?? '99:99').localeCompare(b.time ?? '99:99');
}

export function isOverdue(date: CivilDate, today: CivilDate): boolean {
  return date < today;
}
