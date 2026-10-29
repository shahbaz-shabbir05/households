/**
 * Medicines and their dose schedule.
 *
 * SAFETY RULE: this service records and reminds. It never suggests, computes,
 * converts or alters a dose.
 *
 * Concretely, that means:
 *  - `doseText` and `frequencyText` are stored and returned byte-for-byte as
 *    the household typed them off the prescription. Nothing parses them.
 *  - the reminder schedule comes from times the household entered explicitly;
 *    it is never inferred from the frequency text ("twice daily" does not
 *    become 09:00 and 21:00 by magic — somebody chooses).
 *  - recording a dose decrements a *count of units the household is tracking*,
 *    by one unit, because the system cannot know how many units a dose is.
 *    That is why `decrementStock` exists and why the count is optional.
 *  - a missed dose is recorded as missed rather than quietly dropped. An
 *    abandoned course is exactly what a household needs to be able to see.
 */

import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  addDays,
  type CivilDate,
  type CreateMedicineInput,
  type DoseStatus,
  type ListDosesQuery,
  type ListMedicinesQuery,
  type RecordDoseInput,
  type RefillMedicineInput,
  type UpdateMedicineInput,
} from '@hms/shared';
import { doctors, householdMembers, households, medicineDoses, medicines } from '../../db/schema/index.js';
import type { Database, DbExecutor } from '../../db/client.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { diffFields, writeAudit } from '../../core/audit.js';
import { assertCan, can } from '../../core/policy/index.js';
import type { RequestContext } from '../../core/request-context.js';
import { instantFrom, todayIn } from '../../core/time.js';
import { offsetOf, paginated } from '../../core/pagination.js';
import type { NotificationService } from '../../core/notifications/index.js';
import type { DoctorService } from './doctors.js';

/** How far ahead doses are materialised. */
const DOSE_HORIZON_DAYS = 30;

export interface MedicineView {
  id: string;
  memberId: string;
  memberName: string | null;
  name: string;
  /** Verbatim. Never parsed, never reformatted. */
  doseText: string;
  frequencyText: string | null;
  instructions: string | null;
  reminderTimes: string[];
  startDate: CivilDate;
  endDate: CivilDate | null;
  quantityRemaining: number | null;
  refillThreshold: number | null;
  prescribedByDoctorId: string | null;
  prescribedByName: string | null;
  isActive: boolean;
  needsRefill: boolean;
  notes: string | null;
}

export interface DoseView {
  id: string;
  medicineId: string;
  medicineName: string;
  doseText: string;
  memberId: string;
  memberName: string | null;
  scheduledOn: CivilDate;
  scheduledAtTime: string;
  status: DoseStatus;
  recordedAt: string | null;
}

export class MedicineService {
  constructor(
    private readonly db: Database,
    private readonly doctorsService: DoctorService,
    private readonly notifications: NotificationService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /* ----------------------------------------------------------- medicines --- */

  async list(ctx: RequestContext, query: ListMedicinesQuery) {
    assertCan(ctx, 'health:read');
    const today = todayIn(ctx.household.timezone, this.now());

    const where = and(
      eq(medicines.householdId, ctx.household.id),
      isNull(medicines.deletedAt),
      ...this.visibilityFilter(ctx),
      ...this.filters(query, today),
    );

    const [rows, totals] = await Promise.all([
      this.db
        .select({
          medicine: medicines,
          memberName: householdMembers.displayName,
          doctorName: doctors.name,
        })
        .from(medicines)
        .leftJoin(householdMembers, eq(householdMembers.id, medicines.memberId))
        .leftJoin(doctors, eq(doctors.id, medicines.prescribedByDoctorId))
        .where(where)
        .orderBy(asc(medicines.name))
        .limit(query.perPage)
        .offset(offsetOf(query)),
      this.db.select({ value: count() }).from(medicines).where(where),
    ]);

    return paginated(
      rows.map((r) => toMedicineView(r.medicine, r.memberName, r.doctorName, today)),
      totals[0]?.value ?? 0,
      query,
    );
  }

  async get(ctx: RequestContext, medicineId: string): Promise<MedicineView> {
    assertCan(ctx, 'health:read');
    const row = await this.find(ctx, medicineId);
    // A teen may see their own medicines and nobody else's.
    assertCan(ctx, 'health:read', { memberId: row.memberId });

    const today = todayIn(ctx.household.timezone, this.now());
    return toMedicineView(row, await this.memberName(row.memberId), await this.doctorName(row.prescribedByDoctorId), today);
  }

  async create(ctx: RequestContext, input: CreateMedicineInput): Promise<MedicineView> {
    assertCan(ctx, 'health:create');
    await this.assertMemberExists(ctx, input.memberId);

    const today = todayIn(ctx.household.timezone, this.now());

    const created = await this.db.transaction(async (tx) => {
      const doctorId = await this.doctorsService.resolveByName(tx, ctx, input.prescribedByDoctorName);

      const [row] = await tx
        .insert(medicines)
        .values({
          householdId: ctx.household.id,
          memberId: input.memberId,
          name: input.name,
          // Stored exactly as given. No trimming of meaning, no parsing.
          doseText: input.doseText,
          frequencyText: input.frequencyText ?? null,
          instructions: input.instructions ?? null,
          reminderTimes: [...input.reminderTimes].sort(),
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          quantityRemaining:
            input.quantityRemaining != null ? String(input.quantityRemaining) : null,
          refillThreshold: input.refillThreshold != null ? String(input.refillThreshold) : null,
          prescribedByDoctorId: doctorId,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();

      await this.generateDoses(tx, ctx.household.timezone, row!, today);

      await writeAudit(tx, ctx, {
        entityType: 'medicine',
        entityId: row!.id,
        action: 'create',
        // The dose is quoted, not summarised — the audit trail of a medical
        // record must say exactly what was entered.
        summary: `Added "${row!.name}" (${row!.doseText}) for a household member`,
      });
      return row!;
    });

    return toMedicineView(
      created,
      await this.memberName(created.memberId),
      await this.doctorName(created.prescribedByDoctorId),
      today,
    );
  }

  async update(ctx: RequestContext, medicineId: string, input: UpdateMedicineInput): Promise<MedicineView> {
    const existing = await this.find(ctx, medicineId);
    assertCan(ctx, 'health:update', { memberId: existing.memberId });

    const today = todayIn(ctx.household.timezone, this.now());
    const { quantityRemaining, refillThreshold, reminderTimes, ...rest } = input;

    const updated = await this.db.transaction(async (tx) => {
      const changes = diffFields(existing as unknown as Record<string, unknown>, input);
      if (!changes) return existing;

      const [row] = await tx
        .update(medicines)
        .set({
          ...rest,
          ...(reminderTimes !== undefined ? { reminderTimes: [...reminderTimes].sort() } : {}),
          ...(quantityRemaining !== undefined
            ? { quantityRemaining: quantityRemaining === null ? null : String(quantityRemaining) }
            : {}),
          ...(refillThreshold !== undefined
            ? { refillThreshold: refillThreshold === null ? null : String(refillThreshold) }
            : {}),
          // A changed refill threshold should be able to notify again.
          ...(refillThreshold !== undefined ? { refillNotifiedOn: null } : {}),
          updatedBy: ctx.user.id,
          updatedAt: this.now(),
        })
        .where(eq(medicines.id, medicineId))
        .returning();

      // Changing the schedule means the future doses are wrong. Only the ones
      // nobody has recorded yet are rebuilt — a taken dose is history.
      if (reminderTimes !== undefined || input.endDate !== undefined) {
        await tx
          .delete(medicineDoses)
          .where(
            and(
              eq(medicineDoses.medicineId, medicineId),
              eq(medicineDoses.status, 'due'),
              gte(medicineDoses.scheduledOn, today),
            ),
          );
        await this.generateDoses(tx, ctx.household.timezone, row!, today);
      }

      await writeAudit(tx, ctx, {
        entityType: 'medicine',
        entityId: medicineId,
        action: 'update',
        changes,
      });
      return row!;
    });

    return toMedicineView(
      updated,
      await this.memberName(updated.memberId),
      await this.doctorName(updated.prescribedByDoctorId),
      today,
    );
  }

  /** Records that more was bought. The count is the household's, not ours. */
  async refill(ctx: RequestContext, medicineId: string, input: RefillMedicineInput): Promise<MedicineView> {
    const existing = await this.find(ctx, medicineId);
    assertCan(ctx, 'health:update', { memberId: existing.memberId });
    const today = todayIn(ctx.household.timezone, this.now());

    const updated = await this.db.transaction(async (tx) => {
      const next = Number(existing.quantityRemaining ?? 0) + input.quantityAdded;
      const [row] = await tx
        .update(medicines)
        .set({
          quantityRemaining: String(next),
          // Clear the flag so a later refill can be flagged again.
          refillNotifiedOn: null,
          updatedBy: ctx.user.id,
          updatedAt: this.now(),
        })
        .where(eq(medicines.id, medicineId))
        .returning();

      await writeAudit(tx, ctx, {
        entityType: 'medicine',
        entityId: medicineId,
        action: 'update',
        summary: `Refilled "${existing.name}": ${input.quantityAdded} added, ${next} remaining`,
      });
      return row!;
    });

    return toMedicineView(
      updated,
      await this.memberName(updated.memberId),
      await this.doctorName(updated.prescribedByDoctorId),
      today,
    );
  }

  async remove(ctx: RequestContext, medicineId: string): Promise<void> {
    const existing = await this.find(ctx, medicineId);
    assertCan(ctx, 'health:delete', { memberId: existing.memberId });

    await this.db.transaction(async (tx) => {
      await tx
        .update(medicines)
        .set({ deletedAt: this.now(), updatedBy: ctx.user.id })
        .where(eq(medicines.id, medicineId));
      // Scheduled doses nobody has recorded are noise once the course is gone;
      // the ones that were taken or missed are history and stay.
      await tx
        .delete(medicineDoses)
        .where(and(eq(medicineDoses.medicineId, medicineId), eq(medicineDoses.status, 'due')));

      await writeAudit(tx, ctx, {
        entityType: 'medicine',
        entityId: medicineId,
        action: 'delete',
        summary: `Removed "${existing.name}" from the household's medicines`,
      });
    });
  }

  /* --------------------------------------------------------------- doses --- */

  async listDoses(ctx: RequestContext, query: ListDosesQuery): Promise<DoseView[]> {
    assertCan(ctx, 'health:read');
    const today = todayIn(ctx.household.timezone, this.now());

    const seesEveryone = can(ctx, 'health:read', {
      memberId: '00000000-0000-0000-0000-000000000000',
    });

    const rows = await this.db
      .select({
        dose: medicineDoses,
        medicineName: medicines.name,
        doseText: medicines.doseText,
        memberName: householdMembers.displayName,
      })
      .from(medicineDoses)
      .innerJoin(medicines, eq(medicines.id, medicineDoses.medicineId))
      .leftJoin(householdMembers, eq(householdMembers.id, medicineDoses.memberId))
      .where(
        and(
          eq(medicineDoses.householdId, ctx.household.id),
          isNull(medicines.deletedAt),
          seesEveryone ? undefined : eq(medicineDoses.memberId, ctx.member.id),
          query.memberId ? eq(medicineDoses.memberId, query.memberId) : undefined,
          query.medicineId ? eq(medicineDoses.medicineId, query.medicineId) : undefined,
          query.status ? eq(medicineDoses.status, query.status) : undefined,
          gte(medicineDoses.scheduledOn, query.from ?? today),
          lte(medicineDoses.scheduledOn, query.to ?? today),
        ),
      )
      .orderBy(asc(medicineDoses.scheduledAt))
      .limit(200);

    return rows.map((r) => toDoseView(r.dose, r.medicineName, r.doseText, r.memberName));
  }

  /**
   * Records what actually happened with one dose.
   *
   * Taking a dose decrements the tracked count by **one unit**, never by an
   * amount read out of the dose text — the system does not know whether
   * "2 tablets" means two of whatever the household is counting.
   */
  async recordDose(ctx: RequestContext, doseId: string, input: RecordDoseInput): Promise<DoseView> {
    const dose = await this.db.query.medicineDoses.findFirst({
      where: and(
        eq(medicineDoses.id, doseId),
        eq(medicineDoses.householdId, ctx.household.id),
      ),
    });
    if (!dose) throw new NotFoundError('Dose');

    // A child may record their own doses; nobody records someone else's
    // unless they are an adult in the household.
    assertCan(ctx, 'health:read', { memberId: dose.memberId });
    if (dose.memberId !== ctx.member.id) assertCan(ctx, 'health:update');

    if (dose.status === 'taken' || dose.status === 'skipped') {
      throw new ConflictError('That dose has already been recorded');
    }

    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(medicineDoses)
        .set({
          status: input.status,
          recordedAt: this.now(),
          recordedByMemberId: ctx.member.id,
          updatedAt: this.now(),
        })
        .where(eq(medicineDoses.id, doseId))
        .returning();

      const medicine = await tx.query.medicines.findFirst({
        where: eq(medicines.id, dose.medicineId),
      });

      if (
        input.status === 'taken' &&
        input.decrementStock &&
        medicine?.quantityRemaining != null
      ) {
        const next = Math.max(0, Number(medicine.quantityRemaining) - 1);
        await tx
          .update(medicines)
          .set({ quantityRemaining: String(next) })
          .where(eq(medicines.id, dose.medicineId));
      }

      await writeAudit(tx, ctx, {
        entityType: 'medicine_dose',
        entityId: doseId,
        action: 'update',
        summary: `Recorded "${medicine?.name ?? 'a medicine'}" as ${input.status} for ${dose.scheduledAtTime}`,
      });

      return { dose: row!, medicine };
    });

    return toDoseView(
      updated.dose,
      updated.medicine?.name ?? 'Medicine',
      updated.medicine?.doseText ?? '',
      await this.memberName(updated.dose.memberId),
    );
  }

  /**
   * Materialises the dose schedule for one medicine up to the horizon.
   *
   * One row per reminder time per day the course is running. The unique index
   * on (medicine_id, scheduled_at) makes a repeat run a no-op, so this is safe
   * to call again after an edit or a restart.
   */
  async generateDoses(
    tx: DbExecutor,
    timezone: string,
    medicine: typeof medicines.$inferSelect,
    today: CivilDate,
  ): Promise<number> {
    if (medicine.reminderTimes.length === 0) return 0;

    // Never backfill: a dose nobody could have been reminded about is not a
    // dose they missed.
    const from = medicine.startDate > today ? medicine.startDate : today;
    const horizonEnd = addDays(today, DOSE_HORIZON_DAYS);
    const to = medicine.endDate && medicine.endDate < horizonEnd ? medicine.endDate : horizonEnd;
    if (from > to) return 0;

    const values: Array<typeof medicineDoses.$inferInsert> = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      for (const time of medicine.reminderTimes) {
        values.push({
          householdId: medicine.householdId,
          medicineId: medicine.id,
          memberId: medicine.memberId,
          scheduledOn: date,
          scheduledAtTime: time,
          scheduledAt: instantFrom(date, time, timezone),
        });
      }
    }
    if (values.length === 0) return 0;

    const inserted = await tx
      .insert(medicineDoses)
      .values(values)
      .onConflictDoNothing({ target: [medicineDoses.medicineId, medicineDoses.scheduledAt] })
      .returning({ id: medicineDoses.id });

    return inserted.length;
  }

  /* ---------------------------------------------------------------- jobs --- */

  /**
   * The daily sweep: extend every running course's schedule, mark doses that
   * came and went, raise dose reminders, and flag anything needing a refill.
   *
   * Global across households by design, and idempotent — every step is either
   * a no-op insert, a one-way status transition, or a deduped notice.
   */
  async sweep(db: DbExecutor, now: Date = this.now()): Promise<number> {
    let touched = 0;

    const running = await db
      .select({ medicine: medicines, timezone: households.timezone })
      .from(medicines)
      .innerJoin(households, eq(households.id, medicines.householdId))
      .where(isNull(medicines.deletedAt))
      .limit(2000);

    for (const row of running) {
      const today = todayIn(row.timezone, now);
      if (row.medicine.endDate && row.medicine.endDate < today) continue;
      touched += await this.generateDoses(db, row.timezone, row.medicine, today);
    }

    // A dose whose time has passed without being recorded is missed. Recorded
    // honestly: an abandoned course is the thing worth noticing.
    const missedCutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const missed = await db
      .update(medicineDoses)
      .set({ status: 'missed', updatedAt: now })
      .where(and(eq(medicineDoses.status, 'due'), lte(medicineDoses.scheduledAt, missedCutoff)))
      .returning({ id: medicineDoses.id });
    touched += missed.length;

    touched += await this.notifyDueDoses(db, now);
    touched += await this.notifyRefills(db, now);
    return touched;
  }

  private async notifyDueDoses(db: DbExecutor, now: Date): Promise<number> {
    const due = await db
      .select({
        dose: medicineDoses,
        medicineName: medicines.name,
        doseText: medicines.doseText,
        timezone: households.timezone,
        quietHoursStart: households.quietHoursStart,
        quietHoursEnd: households.quietHoursEnd,
      })
      .from(medicineDoses)
      .innerJoin(medicines, eq(medicines.id, medicineDoses.medicineId))
      .innerJoin(households, eq(households.id, medicineDoses.householdId))
      .where(
        and(
          eq(medicineDoses.status, 'due'),
          isNull(medicineDoses.notifiedAt),
          lte(medicineDoses.scheduledAt, now),
          isNull(medicines.deletedAt),
        ),
      )
      .limit(500);

    for (const row of due) {
      await this.notifications.publish(
        db,
        {
          timezone: row.timezone,
          quietHoursStart: row.quietHoursStart,
          quietHoursEnd: row.quietHoursEnd,
        },
        {
          householdId: row.dose.householdId,
          memberIds: [row.dose.memberId],
          type: 'medicine.due',
          title: `${row.medicineName} — ${row.doseText}`,
          body: `Due at ${row.dose.scheduledAtTime}`,
          // Urgent so it is never held back by quiet hours: a dose deferred to
          // the morning is not a reminder, it is the wrong information.
          priority: 'urgent',
          entityType: 'medicine_dose',
          entityId: row.dose.id,
          dedupeKey: `dose:${row.dose.id}`,
        },
      );
      await db
        .update(medicineDoses)
        .set({ notifiedAt: now })
        .where(eq(medicineDoses.id, row.dose.id));
    }

    return due.length;
  }

  private async notifyRefills(db: DbExecutor, now: Date): Promise<number> {
    const low = await db
      .select({
        medicine: medicines,
        timezone: households.timezone,
        quietHoursStart: households.quietHoursStart,
        quietHoursEnd: households.quietHoursEnd,
      })
      .from(medicines)
      .innerJoin(households, eq(households.id, medicines.householdId))
      .where(
        and(
          isNull(medicines.deletedAt),
          sql`${medicines.refillThreshold} IS NOT NULL`,
          sql`${medicines.quantityRemaining} IS NOT NULL`,
          sql`${medicines.quantityRemaining} <= ${medicines.refillThreshold}`,
        ),
      )
      .limit(500);

    let sent = 0;
    for (const row of low) {
      const today = todayIn(row.timezone, now);
      if (row.medicine.refillNotifiedOn === today) continue;

      await this.notifications.publish(
        db,
        {
          timezone: row.timezone,
          quietHoursStart: row.quietHoursStart,
          quietHoursEnd: row.quietHoursEnd,
        },
        {
          householdId: row.medicine.householdId,
          memberIds: [row.medicine.memberId],
          type: 'medicine.refill',
          title: `${row.medicine.name} is running low`,
          body: `${row.medicine.quantityRemaining} left`,
          priority: 'high',
          entityType: 'medicine',
          entityId: row.medicine.id,
          dedupeKey: `medicine-refill:${row.medicine.id}`,
        },
      );

      await db
        .update(medicines)
        .set({ refillNotifiedOn: today })
        .where(eq(medicines.id, row.medicine.id));
      sent += 1;
    }

    return sent;
  }

  /* ------------------------------------------------------------- helpers --- */

  private filters(query: ListMedicinesQuery, today: CivilDate): SQL[] {
    const filters: SQL[] = [];
    if (query.memberId) filters.push(eq(medicines.memberId, query.memberId));
    if (query.active) {
      filters.push(
        and(
          lte(medicines.startDate, today),
          or(isNull(medicines.endDate), gte(medicines.endDate, today)),
        )!,
      );
    }
    if (query.needsRefill) {
      filters.push(
        sql`${medicines.refillThreshold} IS NOT NULL AND ${medicines.quantityRemaining} IS NOT NULL AND ${medicines.quantityRemaining} <= ${medicines.refillThreshold}`,
      );
    }
    return filters;
  }

  /** A teen or child sees only their own medicines, never a sibling's. */
  private visibilityFilter(ctx: RequestContext): SQL[] {
    if (can(ctx, 'health:read', { memberId: '00000000-0000-0000-0000-000000000000' })) return [];
    return [eq(medicines.memberId, ctx.member.id)];
  }

  private async find(ctx: RequestContext, medicineId: string) {
    const row = await this.db.query.medicines.findFirst({
      where: and(
        eq(medicines.id, medicineId),
        eq(medicines.householdId, ctx.household.id),
        isNull(medicines.deletedAt),
      ),
    });
    if (!row) throw new NotFoundError('Medicine');
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

function toMedicineView(
  row: typeof medicines.$inferSelect,
  memberName: string | null,
  doctorName: string | null,
  today: CivilDate,
): MedicineView {
  const quantityRemaining = row.quantityRemaining === null ? null : Number(row.quantityRemaining);
  const refillThreshold = row.refillThreshold === null ? null : Number(row.refillThreshold);

  return {
    id: row.id,
    memberId: row.memberId,
    memberName,
    name: row.name,
    doseText: row.doseText,
    frequencyText: row.frequencyText,
    instructions: row.instructions,
    reminderTimes: row.reminderTimes,
    startDate: row.startDate,
    endDate: row.endDate,
    quantityRemaining,
    refillThreshold,
    prescribedByDoctorId: row.prescribedByDoctorId,
    prescribedByName: doctorName,
    isActive: row.startDate <= today && (row.endDate === null || row.endDate >= today),
    needsRefill:
      refillThreshold !== null && quantityRemaining !== null && quantityRemaining <= refillThreshold,
    notes: row.notes,
  };
}

function toDoseView(
  row: typeof medicineDoses.$inferSelect,
  medicineName: string,
  doseText: string,
  memberName: string | null,
): DoseView {
  return {
    id: row.id,
    medicineId: row.medicineId,
    medicineName,
    doseText,
    memberId: row.memberId,
    memberName,
    scheduledOn: row.scheduledOn,
    scheduledAtTime: row.scheduledAtTime,
    status: row.status,
    recordedAt: row.recordedAt?.toISOString() ?? null,
  };
}

export { inArray, desc };
