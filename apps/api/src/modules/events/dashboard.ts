import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { events } from '../../db/schema/index.js';
import { can } from '../../core/policy/index.js';
import type { DashboardContributor, DashboardItem } from '../dashboard/types.js';

export const eventDashboardContributor: DashboardContributor = {
  name: 'events',

  async collect(db, ctx, window) {
    if (!can(ctx, 'event:read')) return [];

    const rows = await db
      .select()
      .from(events)
      .where(
        and(
          eq(events.householdId, ctx.household.id),
          isNull(events.deletedAt),
          gte(events.startDate, window.today),
          lte(events.startDate, window.weekTo),
        ),
      )
      .orderBy(asc(events.startDate))
      .limit(50);

    return rows.map((event): DashboardItem => ({
      id: event.id,
      entityType: 'event',
      title: event.title,
      subtitle: event.location,
      date: event.startDate,
      time: event.startTime,
      // Events are informational; they are never "overdue".
      priority: 'normal',
      isOverdue: false,
    }));
  },
};
