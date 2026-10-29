/**
 * Doctor's appointments.
 *
 * Stored as a civil date plus a wall-clock time, so a 4pm appointment is 4pm
 * where the household lives. `outcomeNotes` records what the doctor said, in
 * the household's own words — it is never interpreted, summarised or acted on
 * by the system.
 */

import { and, asc, count, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';
import {
  addDays,
  type AppointmentStatus,
  type CivilDate,
  type CreateAppointmentInput,
  type ListAppointmentsQuery,
  type UpdateAppointmentInput,
} from '@hms/shared';
import { appointments, doctors, householdMembers, households } from '../../db/schema/index.js';
import type { Database, DbExecutor } from '../../db/client.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { diffFields, writeAudit } from '../../core/audit.js';
import { assertCan, can } from '../../core/policy/index.js';
import type { RequestContext } from '../../core/request-context.js';
import { todayIn } from '../../core/time.js';
import { offsetOf, paginated } from '../../core/pagination.js';
import { createSeries } from '../../core/series.js';
import type { Materialiser } from '../../core/recurrence-service.js';
import type { NotificationService } from '../../core/notifications/index.js';
import type { DoctorService } from './doctors.js';

export interface AppointmentView {
  id: string;
  memberId: string;
  memberName: string | null;
  doctorId: string | null;
  doctorName: string | null;
  scheduledOn: CivilDate;
  scheduledAtTime: string | null;
  location: string | null;
  reason: string | null;
  status: AppointmentStatus;
  outcomeNotes: string | null;
  followUpOn: CivilDate | null;
  remindDaysBefore: number;
  isRecurring: boolean;
  notes: string | null;
}

interface AppointmentTemplate {
  memberId: string;
  doctorId?: string | null;
  scheduledAtTime?: string | null;
  location?: string | null;
  reason?: string | null;
  remindDaysBefore: number;
  notes?: string | null;
  createdBy?: string | null;
}

export class AppointmentService {
  constructor(
    private readonly db: Database,
    private readonly doctorsService: DoctorService,
    private readonly notifications: NotificationService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  readonly materialiser: Materialiser = async ({ db, householdId, seriesId, occurrenceDate, template }) => {
    const t = template as unknown as AppointmentTemplate;
    const [row] = await db
      .insert(appointments)
      .values({
        householdId,
        memberId: t.memberId,
        doctorId: t.doctorId ?? null,
        scheduledOn: occurrenceDate,
        scheduledAtTime: t.scheduledAtTime ?? null,
        location: t.location ?? null,
        reason: t.reason ?? null,
        remindDaysBefore: t.remindDaysBefore,
        notes: t.notes ?? null,
        seriesId,
        occurrenceDate,
        createdBy: t.createdBy ?? null,
      })
      .returning({ id: appointments.id });
    return row!.id;
  };

  async list(ctx: RequestContext, query: ListAppointmentsQuery) {
    assertCan(ctx, 'health:read');
    const today = todayIn(ctx.household.timezone, this.now());

    const where = and(
      eq(appointments.householdId, ctx.household.id),
      isNull(appointments.deletedAt),
      ...this.visibilityFilter(ctx),
      ...this.filters(query, today),
    );

    const [rows, totals] = await Promise.all([
      this.db
        .select({
          appointment: appointments,
          memberName: householdMembers.displayName,
          doctorName: doctors.name,
        })
        .from(appointments)
        .leftJoin(householdMembers, eq(householdMembers.id, appointments.memberId))
        .leftJoin(doctors, eq(doctors.id, appointments.doctorId))
        .where(where)
        .orderBy(asc(appointments.scheduledOn), asc(appointments.scheduledAtTime))
        .limit(query.perPage)
        .offset(offsetOf(query)),
      this.db.select({ value: count() }).from(appointments).where(where),
    ]);

    return paginated(
      rows.map((r) => toView(r.appointment, r.memberName, r.doctorName)),
      totals[0]?.value ?? 0,
      query,
    );
  }

  async get(ctx: RequestContext, appointmentId: string): Promise<AppointmentView> {
    assertCan(ctx, 'health:read');
    const row = await this.find(ctx, appointmentId);
    assertCan(ctx, 'health:read', { memberId: row.memberId });
    return toView(row, await this.memberName(row.memberId), await this.doctorName(row.doctorId));
  }

  async create(ctx: RequestContext, input: CreateAppointmentInput): Promise<AppointmentView> {
    assertCan(ctx, 'health:create');
    await this.assertMemberExists(ctx, input.memberId);

    const created = await this.db.transaction(async (tx) => {
      const doctorId =
        input.doctorId ?? (await this.doctorsService.resolveByName(tx, ctx, input.doctorName));

      if (input.recurrence) {
        const template: AppointmentTemplate = {
          memberId: input.memberId,
          doctorId,
          scheduledAtTime: input.scheduledAtTime ?? null,
          location: input.location ?? null,
          reason: input.reason ?? null,
          remindDaysBefore: input.remindDaysBefore,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
        };

        const { seriesId } = await createSeries(
          tx,
          {
            householdId: ctx.household.id,
            entityType: 'appointment',
            rule: input.recurrence,
            template: template as unknown as Record<string, unknown>,
            anchorDate: input.scheduledOn,
            timezone: ctx.household.timezone,
          },
          this.materialiser,
          this.now(),
        );

        const first = await tx.query.appointments.findFirst({
          where: eq(appointments.seriesId, seriesId),
          orderBy: asc(appointments.occurrenceDate),
        });
        if (!first) throw new ValidationError('That repeat rule produces no dates');

        await writeAudit(tx, ctx, {
          entityType: 'appointment',
          entityId: first.id,
          action: 'create',
          summary: 'Booked a repeating appointment',
        });
        return first;
      }

      const [row] = await tx
        .insert(appointments)
        .values({
          householdId: ctx.household.id,
          memberId: input.memberId,
          doctorId,
          scheduledOn: input.scheduledOn,
          scheduledAtTime: input.scheduledAtTime ?? null,
          location: input.location ?? null,
          reason: input.reason ?? null,
          remindDaysBefore: input.remindDaysBefore,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();

      await writeAudit(tx, ctx, {
        entityType: 'appointment',
        entityId: row!.id,
        action: 'create',
        summary: `Booked an appointment on ${row!.scheduledOn}`,
      });
      return row!;
    });

    return toView(
      created,
      await this.memberName(created.memberId),
      await this.doctorName(created.doctorId),
    );
  }

  async update(
    ctx: RequestContext,
    appointmentId: string,
    input: UpdateAppointmentInput,
  ): Promise<AppointmentView> {
    const existing = await this.find(ctx, appointmentId);
    assertCan(ctx, 'health:update', { memberId: existing.memberId });

    const updated = await this.db.transaction(async (tx) => {
      const { doctorName, ...fields } = input;
      const doctorId = doctorName
        ? await this.doctorsService.resolveByName(tx, ctx, doctorName)
        : undefined;

      const changes = diffFields(existing as unknown as Record<string, unknown>, fields);
      if (!changes && doctorId === undefined) return existing;

      const [row] = await tx
        .update(appointments)
        .set({
          ...fields,
          ...(doctorId !== undefined ? { doctorId } : {}),
          // Moving the date means the old reminder no longer applies.
          ...(fields.scheduledOn !== undefined ? { reminderSentOn: null } : {}),
          updatedBy: ctx.user.id,
          updatedAt: this.now(),
        })
        .where(eq(appointments.id, appointmentId))
        .returning();

      await writeAudit(tx, ctx, {
        entityType: 'appointment',
        entityId: appointmentId,
        action: 'update',
        changes,
      });
      return row!;
    });

    return toView(
      updated,
      await this.memberName(updated.memberId),
      await this.doctorName(updated.doctorId),
    );
  }

  async remove(ctx: RequestContext, appointmentId: string): Promise<void> {
    const existing = await this.find(ctx, appointmentId);
    assertCan(ctx, 'health:delete', { memberId: existing.memberId });

    await this.db.transaction(async (tx) => {
      await tx
        .update(appointments)
        .set({ deletedAt: this.now(), updatedBy: ctx.user.id })
        .where(eq(appointments.id, appointmentId));
      await writeAudit(tx, ctx, {
        entityType: 'appointment',
        entityId: appointmentId,
        action: 'delete',
        summary: `Cancelled the appointment on ${existing.scheduledOn}`,
      });
    });
  }

  /** Reminds about appointments coming up inside their notice window. */
  async notifyUpcoming(db: DbExecutor, now: Date = this.now()): Promise<number> {
    const rows = await db
      .select({
        appointment: appointments,
        doctorName: doctors.name,
        timezone: households.timezone,
        quietHoursStart: households.quietHoursStart,
        quietHoursEnd: households.quietHoursEnd,
      })
      .from(appointments)
      .innerJoin(households, eq(households.id, appointments.householdId))
      .leftJoin(doctors, eq(doctors.id, appointments.doctorId))
      .where(and(eq(appointments.status, 'scheduled'), isNull(appointments.deletedAt)))
      .limit(1000);

    let sent = 0;
    for (const row of rows) {
      const today = todayIn(row.timezone, now);
      const appointment = row.appointment;

      if (appointment.scheduledOn < today) continue;
      if (appointment.scheduledOn > addDays(today, appointment.remindDaysBefore)) continue;
      // Once per appointment per day, not once per sweep.
      if (appointment.reminderSentOn === today) continue;

      const when =
        appointment.scheduledOn === today
          ? `today${appointment.scheduledAtTime ? ` at ${appointment.scheduledAtTime}` : ''}`
          : `on ${appointment.scheduledOn}`;

      await this.notifications.publish(
        db,
        {
          timezone: row.timezone,
          quietHoursStart: row.quietHoursStart,
          quietHoursEnd: row.quietHoursEnd,
        },
        {
          householdId: appointment.householdId,
          memberIds: [appointment.memberId],
          type: 'appointment.upcoming',
          title: row.doctorName ? `Appointment with ${row.doctorName}` : 'Appointment coming up',
          body: `${when}${appointment.location ? ` · ${appointment.location}` : ''}`,
          priority: appointment.scheduledOn === today ? 'high' : 'normal',
          entityType: 'appointment',
          entityId: appointment.id,
          dedupeKey: `appointment:${appointment.id}:${appointment.scheduledOn}`,
        },
      );

      await db
        .update(appointments)
        .set({ reminderSentOn: today })
        .where(eq(appointments.id, appointment.id));
      sent += 1;
    }

    return sent;
  }

  private filters(query: ListAppointmentsQuery, today: CivilDate): SQL[] {
    const filters: SQL[] = [];
    if (query.memberId) filters.push(eq(appointments.memberId, query.memberId));
    if (query.status) filters.push(eq(appointments.status, query.status));
    if (query.upcoming) {
      filters.push(
        and(gte(appointments.scheduledOn, today), eq(appointments.status, 'scheduled'))!,
      );
    }
    if (query.from) filters.push(gte(appointments.scheduledOn, query.from));
    if (query.to) filters.push(lte(appointments.scheduledOn, query.to));
    return filters;
  }

  /** A teen or child sees only their own appointments. */
  private visibilityFilter(ctx: RequestContext): SQL[] {
    if (can(ctx, 'health:read', { memberId: '00000000-0000-0000-0000-000000000000' })) return [];
    return [eq(appointments.memberId, ctx.member.id)];
  }

  private async find(ctx: RequestContext, appointmentId: string) {
    const row = await this.db.query.appointments.findFirst({
      where: and(
        eq(appointments.id, appointmentId),
        eq(appointments.householdId, ctx.household.id),
        isNull(appointments.deletedAt),
      ),
    });
    if (!row) throw new NotFoundError('Appointment');
    return row;
  }

  private async memberName(memberId: string): Promise<string | null> {
    const row = await this.db.query.householdMembers.findFirst({
      where: eq(householdMembers.id, memberId),
      columns: { displayName: true },
    });
    return row?.displayName ?? null;
  }

  private async doctorName(doctorId: string | null): Promise<string | null> {
    if (!doctorId) return null;
    const row = await this.db.query.doctors.findFirst({
      where: eq(doctors.id, doctorId),
      columns: { name: true },
    });
    return row?.name ?? null;
  }

  private async assertMemberExists(ctx: RequestContext, memberId: string): Promise<void> {
    const row = await this.db.query.householdMembers.findFirst({
      where: and(
        eq(householdMembers.id, memberId),
        eq(householdMembers.householdId, ctx.household.id),
        isNull(householdMembers.deletedAt),
      ),
      columns: { id: true },
    });
    if (!row) {
      throw new ValidationError('That person is not a member of this household', [
        { path: 'memberId', message: 'Unknown member' },
      ]);
    }
  }
}

function toView(
  row: typeof appointments.$inferSelect,
  memberName: string | null,
  doctorName: string | null,
): AppointmentView {
  return {
    id: row.id,
    memberId: row.memberId,
    memberName,
    doctorId: row.doctorId,
    doctorName,
    scheduledOn: row.scheduledOn,
    scheduledAtTime: row.scheduledAtTime,
    location: row.location,
    reason: row.reason,
    status: row.status,
    outcomeNotes: row.outcomeNotes,
    followUpOn: row.followUpOn,
    remindDaysBefore: row.remindDaysBefore,
    isRecurring: row.seriesId !== null,
    notes: row.notes,
  };
}

export { sql };
