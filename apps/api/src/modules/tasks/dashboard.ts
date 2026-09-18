/**
 * The tasks module's contribution to the dashboard.
 *
 * Registered rather than imported by the dashboard, so adding a module never
 * means editing the dashboard service (docs/03).
 */

import { and, asc, eq, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { householdMembers, tasks } from '../../db/schema/index.js';
import { can } from '../../core/policy/index.js';
import type { DashboardContributor, DashboardItem } from '../dashboard/types.js';

export const taskDashboardContributor: DashboardContributor = {
  name: 'tasks',

  async collect(db, ctx, window) {
    if (!can(ctx, 'task:read')) return [];

    // Everything open and dated up to the end of the week, plus anything
    // already overdue — which is the whole point of the section.
    const rows = await db
      .select({ task: tasks, assigneeName: householdMembers.displayName })
      .from(tasks)
      .leftJoin(householdMembers, eq(householdMembers.id, tasks.assigneeMemberId))
      .where(
        and(
          eq(tasks.householdId, ctx.household.id),
          isNull(tasks.deletedAt),
          inArray(tasks.status, ['pending', 'in_progress']),
          isNotNull(tasks.dueDate),
          lte(tasks.dueDate, window.weekTo),
          // A restricted role sees only their own work here too.
          can(ctx, 'task:read', { assigneeMemberId: '00000000-0000-0000-0000-000000000000' })
            ? undefined
            : or(eq(tasks.assigneeMemberId, ctx.member.id), eq(tasks.createdByMemberId, ctx.member.id)),
        ),
      )
      .orderBy(asc(tasks.dueDate))
      .limit(100);

    return rows.map(({ task, assigneeName }): DashboardItem => ({
      id: task.id,
      entityType: 'task',
      title: task.title,
      subtitle: assigneeName,
      date: task.dueDate!,
      time: task.dueTime,
      priority: task.priority,
      isOverdue: task.dueDate! < window.today,
      assigneeMemberId: task.assigneeMemberId,
      assigneeName,
      quickAction: 'task:complete',
    }));
  },
};
