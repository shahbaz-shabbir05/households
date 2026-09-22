/**
 * Calendar events.
 *
 * Events are stored as civil date + optional time, not as a bare instant,
 * because the dominant household event types — birthdays, anniversaries,
 * holidays — are date-only. Forcing them through a timestamp is how a birthday
 * ends up showing a day early for half the family (docs/04).
 */

import { and, asc, count, eq, gte, ilike, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';
import type {
  CivilDate,
  CreateEventInput,
  EventType,
  ListEventsQuery,
  UpdateEventInput,
} from '@hms/shared';
import { addDays } from '@hms/shared';
import { eventParticipants, events, householdMembers } from '../../db/schema/index.js';
import type { Database } from '../../db/client.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { diffFields, writeAudit } from '../../core/audit.js';
import { assertCan } from '../../core/policy/index.js';
import type { RequestContext } from '../../core/request-context.js';
import { offsetOf, paginated } from '../../core/pagination.js';
import { createSeries } from '../../core/series.js';
import type { Materialiser } from '../../core/recurrence-service.js';

export interface EventView {
  id: string;
  title: string;
  description: string | null;
  eventType: EventType;
  startDate: CivilDate;
  startTime: string | null;
  endDate: CivilDate | null;
  endTime: string | null;
  isAllDay: boolean;
  location: string | null;
  participantMemberIds: string[];
  isRecurring: boolean;
  seriesId: string | null;
  createdAt: string;
}

interface EventTemplate {
  title: string;
  description?: string | null;
  eventType: EventType;
  startTime?: string | null;
  endTime?: string | null;
  isAllDay: boolean;
  location?: string | null;
  /** Length in days, so a multi-day event repeats with the same span. */
  durationDays: number;
  participantMemberIds: string[];
  createdByMemberId?: string | null;
  createdBy?: string | null;
}

export class EventService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  readonly materialiser: Materialiser = async ({ db, householdId, seriesId, occurrenceDate, template }) => {
    const t = template as unknown as EventTemplate;
    const [row] = await db
      .insert(events)
      .values({
        householdId,
        title: t.title,
        description: t.description ?? null,
        eventType: t.eventType,
        startDate: occurrenceDate,
        startTime: t.startTime ?? null,
        endDate: t.durationDays > 0 ? addDays(occurrenceDate, t.durationDays) : null,
        endTime: t.endTime ?? null,
        isAllDay: t.isAllDay,
        location: t.location ?? null,
        createdByMemberId: t.createdByMemberId ?? null,
        seriesId,
        occurrenceDate,
        createdBy: t.createdBy ?? null,
      })
      .returning({ id: events.id });

    if (t.participantMemberIds.length > 0) {
      await db
        .insert(eventParticipants)
        .values(t.participantMemberIds.map((memberId) => ({ eventId: row!.id, memberId })))
        .onConflictDoNothing();
    }
    return row!.id;
  };

  async list(ctx: RequestContext, query: ListEventsQuery) {
    assertCan(ctx, 'event:read');

    const where = and(
      eq(events.householdId, ctx.household.id),
      isNull(events.deletedAt),
      ...this.filters(query),
    );

    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(events)
        .where(where)
        .orderBy(asc(events.startDate), asc(events.startTime))
        .limit(query.perPage)
        .offset(offsetOf(query)),
      this.db.select({ value: count() }).from(events).where(where),
    ]);

    const participants = await this.participantsFor(rows.map((r) => r.id));
    return paginated(
      rows.map((row) => toView(row, participants.get(row.id) ?? [])),
      totals[0]?.value ?? 0,
      query,
    );
  }

  async get(ctx: RequestContext, eventId: string): Promise<EventView> {
    assertCan(ctx, 'event:read');
    const row = await this.find(ctx, eventId);
    const participants = await this.participantsFor([row.id]);
    return toView(row, participants.get(row.id) ?? []);
  }

  async create(ctx: RequestContext, input: CreateEventInput): Promise<EventView> {
    assertCan(ctx, 'event:create');
    await this.assertParticipantsExist(ctx, input.participantMemberIds);

    const isAllDay = !input.startTime;
    const durationDays = input.endDate
      ? Math.max(0, daysBetween(input.startDate, input.endDate))
      : 0;

    const created = await this.db.transaction(async (tx) => {
      if (input.recurrence) {
        const template: EventTemplate = {
          title: input.title,
          description: input.description ?? null,
          eventType: input.eventType,
          startTime: input.startTime ?? null,
          endTime: input.endTime ?? null,
          isAllDay,
          location: input.location ?? null,
          durationDays,
          participantMemberIds: input.participantMemberIds,
          createdByMemberId: ctx.member.id,
          createdBy: ctx.user.id,
        };

        const { seriesId } = await createSeries(
          tx,
          {
            householdId: ctx.household.id,
            entityType: 'event',
            rule: input.recurrence,
            template: template as unknown as Record<string, unknown>,
            anchorDate: input.startDate,
            timezone: ctx.household.timezone,
          },
          this.materialiser,
          this.now(),
        );

        const first = await tx.query.events.findFirst({
          where: eq(events.seriesId, seriesId),
          orderBy: asc(events.occurrenceDate),
        });
        if (!first) throw new ValidationError('That repeat rule produces no dates');

        await writeAudit(tx, ctx, {
          entityType: 'event',
          entityId: first.id,
          action: 'create',
          summary: `Created repeating event "${input.title}"`,
        });
        return first;
      }

      const [row] = await tx
        .insert(events)
        .values({
          householdId: ctx.household.id,
          title: input.title,
          description: input.description ?? null,
          eventType: input.eventType,
          startDate: input.startDate,
          startTime: input.startTime ?? null,
          endDate: input.endDate ?? null,
          endTime: input.endTime ?? null,
          isAllDay,
          location: input.location ?? null,
          createdByMemberId: ctx.member.id,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();

      if (input.participantMemberIds.length > 0) {
        await tx
          .insert(eventParticipants)
          .values(input.participantMemberIds.map((memberId) => ({ eventId: row!.id, memberId })));
      }

      await writeAudit(tx, ctx, {
        entityType: 'event',
        entityId: row!.id,
        action: 'create',
        summary: `Created event "${row!.title}"`,
      });
      return row!;
    });

    const participants = await this.participantsFor([created.id]);
    return toView(created, participants.get(created.id) ?? []);
  }

  async update(ctx: RequestContext, eventId: string, input: UpdateEventInput): Promise<EventView> {
    const existing = await this.find(ctx, eventId);
    assertCan(ctx, 'event:update', { createdByMemberId: existing.createdByMemberId });
    if (input.participantMemberIds) {
      await this.assertParticipantsExist(ctx, input.participantMemberIds);
    }

    const { participantMemberIds, recurrence: _recurrence, ...fields } = input;

    const updated = await this.db.transaction(async (tx) => {
      const changes = diffFields(existing as unknown as Record<string, unknown>, fields);

      const row = changes
        ? (
            await tx
              .update(events)
              .set({
                ...fields,
                ...(fields.startTime !== undefined ? { isAllDay: !fields.startTime } : {}),
                ...(existing.seriesId ? { isDetached: true } : {}),
                updatedBy: ctx.user.id,
                updatedAt: this.now(),
              })
              .where(eq(events.id, eventId))
              .returning()
          )[0]!
        : existing;

      if (participantMemberIds) {
        // Replace wholesale: a participant list is a set, not a log.
        await tx.delete(eventParticipants).where(eq(eventParticipants.eventId, eventId));
        if (participantMemberIds.length > 0) {
          await tx
            .insert(eventParticipants)
            .values(participantMemberIds.map((memberId) => ({ eventId, memberId })));
        }
      }

      if (changes) {
        await writeAudit(tx, ctx, { entityType: 'event', entityId: eventId, action: 'update', changes });
      }
      return row;
    });

    const participants = await this.participantsFor([eventId]);
    return toView(updated, participants.get(eventId) ?? []);
  }

  async remove(ctx: RequestContext, eventId: string): Promise<void> {
    const existing = await this.find(ctx, eventId);
    assertCan(ctx, 'event:delete', { createdByMemberId: existing.createdByMemberId });

    await this.db.transaction(async (tx) => {
      await tx
        .update(events)
        .set({ deletedAt: this.now(), updatedBy: ctx.user.id })
        .where(eq(events.id, eventId));
      await writeAudit(tx, ctx, {
        entityType: 'event',
        entityId: eventId,
        action: 'delete',
        summary: `Deleted event "${existing.title}"`,
      });
    });
  }

  private filters(query: ListEventsQuery): SQL[] {
    const filters: SQL[] = [];
    // An event overlaps the window if it starts before the window ends and
    // ends (or starts, when single-day) on or after the window begins.
    if (query.to) filters.push(lte(events.startDate, query.to));
    if (query.from) {
      filters.push(
        or(gte(events.startDate, query.from), gte(events.endDate, query.from))!,
      );
    }
    if (query.eventType) filters.push(eq(events.eventType, query.eventType));
    if (query.search) {
      const term = `%${query.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      filters.push(or(ilike(events.title, term), ilike(events.location, term))!);
    }
    return filters;
  }

  private async participantsFor(eventIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (eventIds.length === 0) return map;

    const rows = await this.db
      .select()
      .from(eventParticipants)
      .where(inArray(eventParticipants.eventId, eventIds));

    for (const row of rows) {
      const list = map.get(row.eventId) ?? [];
      list.push(row.memberId);
      map.set(row.eventId, list);
    }
    return map;
  }

  private async find(ctx: RequestContext, eventId: string) {
    const row = await this.db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.householdId, ctx.household.id), isNull(events.deletedAt)),
    });
    if (!row) throw new NotFoundError('Event');
    return row;
  }

  private async assertParticipantsExist(ctx: RequestContext, memberIds: string[]): Promise<void> {
    if (memberIds.length === 0) return;
    const rows = await this.db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, ctx.household.id),
          inArray(householdMembers.id, memberIds),
          isNull(householdMembers.deletedAt),
        ),
      );
    if (rows.length !== new Set(memberIds).size) {
      throw new ValidationError('One or more participants are not members of this household', [
        { path: 'participantMemberIds', message: 'Unknown member' },
      ]);
    }
  }
}

function daysBetween(from: CivilDate, to: CivilDate): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

function toView(row: typeof events.$inferSelect, participantMemberIds: string[]): EventView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    eventType: row.eventType,
    startDate: row.startDate,
    startTime: row.startTime,
    endDate: row.endDate,
    endTime: row.endTime,
    isAllDay: row.isAllDay,
    location: row.location,
    participantMemberIds,
    isRecurring: row.seriesId !== null,
    seriesId: row.seriesId,
    createdAt: row.createdAt.toISOString(),
  };
}
