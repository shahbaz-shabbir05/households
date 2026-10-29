import { and, asc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { householdMembers, reminders } from '../../db/schema/index.js';
import { can } from '../../core/policy/index.js';
import type { DashboardContributor, DashboardItem } from '../dashboard/types.js';

export const reminderDashboardContributor: DashboardContributor = {
  name: 'reminders',

  async collect(db, ctx, window) {
    if (!can(ctx, 'reminder:read')) return [];

    const seesEveryone = can(ctx, 'reminder:read', {
      memberId: '00000000-0000-0000-0000-000000000000',
    });

    const rows = await db
      .select({ reminder: reminders, assigneeName: householdMembers.displayName })
      .from(reminders)
      .leftJoin(householdMembers, eq(householdMembers.id, reminders.assigneeMemberId))
      .where(
        and(
          eq(reminders.householdId, ctx.household.id),
          isNull(reminders.deletedAt),
          // Sent-but-not-dismissed still needs attention: the user saw the
          // notification but has not acted on it.
          inArray(reminders.status, ['pending', 'sent', 'snoozed']),
          lte(reminders.remindOnDate, window.weekTo),
          seesEveryone ? undefined : eq(reminders.assigneeMemberId, ctx.member.id),
        ),
      )
      .orderBy(asc(reminders.remindAt))
      .limit(50);

    return rows.map(({ reminder, assigneeName }): DashboardItem => ({
      id: reminder.id,
      entityType: 'reminder',
      title: reminder.title,
      subtitle: assigneeName,
      date: reminder.remindOnDate,
      time: reminder.remindAtTime,
      priority: reminder.priority,
      isOverdue: reminder.remindOnDate < window.today,
      assigneeMemberId: reminder.assigneeMemberId,
      assigneeName,
      quickAction: 'reminder:dismiss',
    }));
  },
};
