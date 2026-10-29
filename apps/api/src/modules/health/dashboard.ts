/**
 * Health on the dashboard: doses due today and appointments coming up.
 *
 * A dose row shows the medicine and its dose text verbatim, so what the
 * household reads on screen is what is written on the box.
 */

import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { appointments, doctors, medicineDoses, medicines } from '../../db/schema/index.js';
import { can } from '../../core/policy/index.js';
import type { DashboardContributor, DashboardItem } from '../dashboard/types.js';

export const healthDashboardContributor: DashboardContributor = {
  name: 'health',

  async collect(db, ctx, window) {
    if (!can(ctx, 'health:read')) return [];

    // A teen or child sees only their own; an adult sees the household's.
    const seesEveryone = can(ctx, 'health:read', {
      memberId: '00000000-0000-0000-0000-000000000000',
    });
    const mineOnly = seesEveryone ? undefined : ctx.member.id;

    const [doses, upcoming] = await Promise.all([
      db
        .select({ dose: medicineDoses, name: medicines.name, doseText: medicines.doseText })
        .from(medicineDoses)
        .innerJoin(medicines, eq(medicines.id, medicineDoses.medicineId))
        .where(
          and(
            eq(medicineDoses.householdId, ctx.household.id),
            isNull(medicines.deletedAt),
            inArray(medicineDoses.status, ['due', 'missed']),
            eq(medicineDoses.scheduledOn, window.today),
            mineOnly ? eq(medicineDoses.memberId, mineOnly) : undefined,
          ),
        )
        .orderBy(asc(medicineDoses.scheduledAt))
        .limit(30),

      db
        .select({ appointment: appointments, doctorName: doctors.name })
        .from(appointments)
        .leftJoin(doctors, eq(doctors.id, appointments.doctorId))
        .where(
          and(
            eq(appointments.householdId, ctx.household.id),
            isNull(appointments.deletedAt),
            eq(appointments.status, 'scheduled'),
            gte(appointments.scheduledOn, window.today),
            lte(appointments.scheduledOn, window.weekTo),
            mineOnly ? eq(appointments.memberId, mineOnly) : undefined,
          ),
        )
        .orderBy(asc(appointments.scheduledOn))
        .limit(20),
    ]);

    const items: DashboardItem[] = doses.map(({ dose, name, doseText }) => ({
      id: dose.id,
      entityType: 'medicine_dose',
      title: `${name} — ${doseText}`,
      subtitle: null,
      date: dose.scheduledOn,
      time: dose.scheduledAtTime,
      // A missed dose is worth seeing, but it is never dressed up as an alarm.
      priority: dose.status === 'missed' ? 'high' : 'urgent',
      isOverdue: dose.status === 'missed',
      assigneeMemberId: dose.memberId,
      quickAction: 'dose:record',
    }));

    for (const { appointment, doctorName } of upcoming) {
      items.push({
        id: appointment.id,
        entityType: 'appointment',
        title: doctorName ? `Appointment with ${doctorName}` : 'Appointment',
        subtitle: appointment.location,
        date: appointment.scheduledOn,
        time: appointment.scheduledAtTime,
        priority: 'high',
        isOverdue: false,
        assigneeMemberId: appointment.memberId,
      });
    }

    return items;
  },
};
