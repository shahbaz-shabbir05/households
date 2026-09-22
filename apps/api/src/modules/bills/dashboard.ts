/**
 * Bills on the dashboard.
 *
 * This is the product's single most valuable row: an unpaid bill discovered
 * after the disconnection notice is the failure the whole thing exists to
 * prevent (docs/00).
 */

import { and, asc, eq, isNull, lte, ne } from 'drizzle-orm';
import { addDays } from '@hms/shared';
import { bills } from '../../db/schema/index.js';
import { can } from '../../core/policy/index.js';
import { deriveStatus } from './service.js';
import type { DashboardContributor, DashboardItem } from '../dashboard/types.js';

export const billDashboardContributor: DashboardContributor = {
  name: 'bills',

  async collect(db, ctx, window) {
    if (!can(ctx, 'bill:read')) return [];

    const rows = await db
      .select()
      .from(bills)
      .where(
        and(
          eq(bills.householdId, ctx.household.id),
          isNull(bills.deletedAt),
          isNull(bills.paidOn),
          ne(bills.status, 'cancelled'),
          // Everything already overdue, plus anything falling due this week.
          lte(bills.dueDate, addDays(window.weekTo, 1)),
        ),
      )
      .orderBy(asc(bills.dueDate))
      .limit(50);

    return rows.map((bill): DashboardItem => {
      const status = deriveStatus(bill, window.today);
      return {
        id: bill.id,
        entityType: 'bill',
        title: bill.name,
        subtitle: bill.accountNumber ? `Account ${bill.accountNumber}` : null,
        date: bill.dueDate,
        priority: status === 'overdue' ? 'urgent' : 'high',
        isOverdue: status === 'overdue',
        amountMinor: Number(bill.amountMinor),
        quickAction: 'bill:pay',
      };
    });
  },
};
