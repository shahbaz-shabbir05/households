/**
 * Reminders.
 *
 * A reminder is a *user-created intention*; a notification is the message it
 * produces. The dispatch job is the bridge between the two (docs/09).
 */

import { and, asc, count, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type {
  CreateReminderInput,
  ListRemindersQuery,
  Priority,
  ReminderStatus,
  UpdateReminderInput,
} from '@hms/shared';
import { householdMembers, households, reminders } from '../../db/schema/index.js';
import type { Database, DbExecutor } from '../../db/client.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { diffFields, writeAudit } from '../../core/audit.js';
import { assertCan, can } from '../../core/policy/index.js';
import type { RequestContext } from '../../core/request-context.js';
import { civilDateIn, instantFrom, timeOfDayIn } from '../../core/time.js';
import { offsetOf, paginated } from '../../core/pagination.js';
import { createSeries } from '../../core/series.js';
import type { Materialiser } from '../../core/recurrence-service.js';
import type { NotificationService } from '../../core/notifications/index.js';

export interface ReminderView {
  id: string;
  title: string;
  body: string | null;
  remindOnDate: string;
  remindAtTime: string;
  remindAt: string;
  priority: Priority;
  status: ReminderStatus;
  assigneeMemberId: string | null;
  assigneeName: string | null;
  entityType: string | null;
  entityId: string | null;
  isRecurring: boolean;
  createdAt: string;
}

interface ReminderTemplate {
  title: string;
  body?: string | null;
  remindAtTime: string;
  priority: Priority;
  assigneeMemberId?: string | null;
  createdByMemberId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  timezone: string;
  createdBy?: string | null;
}

export class ReminderService {
  constructor(
    private readonly db: Database,
    private readonly notifications: NotificationService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  readonly materialiser: Materialiser = async ({ db, householdId, seriesId, occurrenceDate, template }) => {
    const t = template as unknown as ReminderTemplate;
    const [row] = await db
      .insert(reminders)
      .values({
        householdId,
        title: t.title,
        body: t.body ?? null,
        remindOnDate: occurrenceDate,
        remindAtTime: t.remindAtTime,
        remindAt: instantFrom(occurrenceDate, t.remindAtTime, t.timezone),
        priority: t.priority,
        assigneeMemberId: t.assigneeMemberId ?? null,
        createdByMemberId: t.createdByMemberId ?? null,
        entityType: (t.entityType ?? null) as never,
        entityId: t.entityId ?? null,
        seriesId,
        occurrenceDate,
        createdBy: t.createdBy ?? null,
      })
      .returning({ id: reminders.id });
    return row!.id;
  };

  async list(ctx: RequestContext, query: ListRemindersQuery) {
    assertCan(ctx, 'reminder:read');

    const where = and(
      eq(reminders.householdId, ctx.household.id),
      isNull(reminders.deletedAt),
      ...this.visibilityFilter(ctx),
      ...this.filters(query),
    );

    const [rows, totals] = await Promise.all([
      this.db
        .select({ reminder: reminders, assigneeName: householdMembers.displayName })
        .from(reminders)
        .leftJoin(householdMembers, eq(householdMembers.id, reminders.assigneeMemberId))
        .where(where)
        .orderBy(asc(reminders.remindAt))
        .limit(query.perPage)
        .offset(offsetOf(query)),
      this.db.select({ value: count() }).from(reminders).where(where),
    ]);

    return paginated(
      rows.map((r) => toView(r.reminder, r.assigneeName)),
      totals[0]?.value ?? 0,
      query,
    );
  }

  async create(ctx: RequestContext, input: CreateReminderInput): Promise<ReminderView> {
    assertCan(ctx, 'reminder:create');

    const created = await this.db.transaction(async (tx) => {
      if (input.recurrence) {
        const template: ReminderTemplate = {
          title: input.title,
          body: input.body ?? null,
          remindAtTime: input.remindAtTime,
          priority: input.priority,
          assigneeMemberId: input.assigneeMemberId ?? ctx.member.id,
          createdByMemberId: ctx.member.id,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          timezone: ctx.household.timezone,
          createdBy: ctx.user.id,
        };

        const { seriesId } = await createSeries(
          tx,
          {
            householdId: ctx.household.id,
            entityType: 'reminder',
            rule: input.recurrence,
            template: template as unknown as Record<string, unknown>,
            anchorDate: input.remindOnDate,
            timezone: ctx.household.timezone,
          },
          this.materialiser,
          this.now(),
        );

        const first = await tx.query.reminders.findFirst({
          where: eq(reminders.seriesId, seriesId),
          orderBy: asc(reminders.occurrenceDate),
        });
        if (!first) throw new ValidationError('That repeat rule produces no dates');

        await writeAudit(tx, ctx, {
          entityType: 'reminder',
          entityId: first.id,
          action: 'create',
          summary: `Created repeating reminder "${input.title}"`,
        });
        return first;
      }

      const [row] = await tx
        .insert(reminders)
        .values({
          householdId: ctx.household.id,
          title: input.title,
          body: input.body ?? null,
          remindOnDate: input.remindOnDate,
          remindAtTime: input.remindAtTime,
          // Converted once, here, using the household's timezone — the
          // dispatcher then sweeps purely on instants (docs/04).
          remindAt: instantFrom(input.remindOnDate, input.remindAtTime, ctx.household.timezone),
          priority: input.priority,
          // Unassigned reminders belong to whoever set them.
          assigneeMemberId: input.assigneeMemberId ?? ctx.member.id,
          createdByMemberId: ctx.member.id,
          entityType: (input.entityType ?? null) as never,
          entityId: input.entityId ?? null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();

      await writeAudit(tx, ctx, {
        entityType: 'reminder',
        entityId: row!.id,
        action: 'create',
        summary: `Created reminder "${row!.title}"`,
      });
      return row!;
    });

    return toView(created, await this.assigneeName(created.assigneeMemberId));
  }

  async update(ctx: RequestContext, reminderId: string, input: UpdateReminderInput): Promise<ReminderView> {
    const existing = await this.find(ctx, reminderId);
    assertCan(ctx, 'reminder:update', policySubject(existing));

    const updated = await this.db.transaction(async (tx) => {
      const changes = diffFields(existing as unknown as Record<string, unknown>, input);
      if (!changes) return existing;

      const date = input.remindOnDate ?? existing.remindOnDate;
      const time = input.remindAtTime ?? existing.remindAtTime;
      const rescheduled =
        input.remindOnDate !== undefined || input.remindAtTime !== undefined
          ? {
              remindAt: instantFrom(date, time, ctx.household.timezone),
              // Rescheduling makes an already-sent reminder due again.
              status: 'pending' as const,
              firedAt: null,
            }
          : {};

      const [row] = await tx
        .update(reminders)
        .set({ ...input, ...rescheduled, updatedBy: ctx.user.id, updatedAt: this.now() })
        .where(eq(reminders.id, reminderId))
        .returning();

      await writeAudit(tx, ctx, { entityType: 'reminder', entityId: reminderId, action: 'update', changes });
      return row!;
    });

    return toView(updated, await this.assigneeName(updated.assigneeMemberId));
  }

  /** Pushes a reminder out by N minutes and makes it due again. */
  async snooze(ctx: RequestContext, reminderId: string, minutes: number): Promise<ReminderView> {
    const existing = await this.find(ctx, reminderId);
    assertCan(ctx, 'reminder:update', policySubject(existing));

    const remindAt = new Date(this.now().getTime() + minutes * 60_000);
    const [row] = await this.db
      .update(reminders)
      .set({
        remindAt,
        remindOnDate: civilDateIn(remindAt, ctx.household.timezone),
        remindAtTime: timeOfDayIn(remindAt, ctx.household.timezone),
        status: 'pending',
        snoozedUntil: remindAt,
        firedAt: null,
        updatedBy: ctx.user.id,
        updatedAt: this.now(),
      })
      .where(eq(reminders.id, reminderId))
      .returning();

    return toView(row!, await this.assigneeName(row!.assigneeMemberId));
  }

  async dismiss(ctx: RequestContext, reminderId: string): Promise<void> {
    const existing = await this.find(ctx, reminderId);
    assertCan(ctx, 'reminder:update', policySubject(existing));
    await this.db
      .update(reminders)
      .set({ status: 'dismissed', updatedBy: ctx.user.id, updatedAt: this.now() })
      .where(eq(reminders.id, reminderId));
  }

  async remove(ctx: RequestContext, reminderId: string): Promise<void> {
    const existing = await this.find(ctx, reminderId);
    assertCan(ctx, 'reminder:delete', policySubject(existing));

    await this.db.transaction(async (tx) => {
      await tx
        .update(reminders)
        .set({ deletedAt: this.now(), updatedBy: ctx.user.id })
        .where(eq(reminders.id, reminderId));
      await writeAudit(tx, ctx, {
        entityType: 'reminder',
        entityId: reminderId,
        action: 'delete',
        summary: `Deleted reminder "${existing.title}"`,
      });
    });
  }

  /**
   * The dispatch sweep: turns every due reminder into a notification.
   *
   * Deliberately global across households — it is the one query that crosses
   * the tenant boundary, and it is named and tested as such (docs/05).
   * Idempotent: the status transition plus the notification dedupe key mean a
   * re-run produces nothing new.
   */
  async dispatchDue(db: DbExecutor, now: Date = this.now(), limit = 500): Promise<number> {
    const due = await db
      .select({
        reminder: reminders,
        timezone: households.timezone,
        quietHoursStart: households.quietHoursStart,
        quietHoursEnd: households.quietHoursEnd,
      })
      .from(reminders)
      .innerJoin(households, eq(households.id, reminders.householdId))
      .where(
        and(
          eq(reminders.status, 'pending'),
          isNull(reminders.deletedAt),
          lte(reminders.remindAt, now),
        ),
      )
      .orderBy(asc(reminders.remindAt))
      .limit(limit);

    let dispatched = 0;
    for (const row of due) {
      const r = row.reminder;
      if (!r.assigneeMemberId) {
        // Nobody to tell; close it out rather than sweeping it forever.
        await db.update(reminders).set({ status: 'dismissed' }).where(eq(reminders.id, r.id));
        continue;
      }

      await this.notifications.publish(
        db,
        {
          timezone: row.timezone,
          quietHoursStart: row.quietHoursStart,
          quietHoursEnd: row.quietHoursEnd,
        },
        {
          householdId: r.householdId,
          memberIds: [r.assigneeMemberId],
          type: 'reminder.due',
          title: r.title,
          body: r.body,
          priority: r.priority,
          entityType: r.entityType ?? 'reminder',
          entityId: r.entityId ?? r.id,
          dedupeKey: `reminder:${r.id}`,
        },
      );

      await db
        .update(reminders)
        .set({ status: 'sent', firedAt: now })
        .where(and(eq(reminders.id, r.id), eq(reminders.status, 'pending')));
      dispatched += 1;
    }

    return dispatched;
  }

  private filters(query: ListRemindersQuery): SQL[] {
    const filters: SQL[] = [];
    if (query.status) filters.push(eq(reminders.status, query.status));
    if (query.assigneeMemberId) filters.push(eq(reminders.assigneeMemberId, query.assigneeMemberId));
    if (query.from) filters.push(gte(reminders.remindOnDate, query.from));
    if (query.to) filters.push(lte(reminders.remindOnDate, query.to));
    return filters;
  }

  private visibilityFilter(ctx: RequestContext): SQL[] {
    if (can(ctx, 'reminder:read', { memberId: '00000000-0000-0000-0000-000000000000' })) return [];
    return [eq(reminders.assigneeMemberId, ctx.member.id)];
  }

  private async find(ctx: RequestContext, reminderId: string) {
    const row = await this.db.query.reminders.findFirst({
      where: and(
        eq(reminders.id, reminderId),
        eq(reminders.householdId, ctx.household.id),
        isNull(reminders.deletedAt),
      ),
    });
    if (!row) throw new NotFoundError('Reminder');
    return row;
  }

  private async assigneeName(memberId: string | null): Promise<string | null> {
    if (!memberId) return null;
    const row = await this.db.query.householdMembers.findFirst({
      where: eq(householdMembers.id, memberId),
      columns: { displayName: true },
    });
    return row?.displayName ?? null;
  }
}

function policySubject(row: typeof reminders.$inferSelect) {
  return { memberId: row.assigneeMemberId, createdByMemberId: row.createdByMemberId };
}

function toView(row: typeof reminders.$inferSelect, assigneeName: string | null): ReminderView {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    remindOnDate: row.remindOnDate,
    remindAtTime: row.remindAtTime,
    remindAt: row.remindAt.toISOString(),
    priority: row.priority,
    status: row.status,
    assigneeMemberId: row.assigneeMemberId,
    assigneeName,
    entityType: row.entityType,
    entityId: row.entityId,
    isRecurring: row.seriesId !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

export { sql, inArray };
