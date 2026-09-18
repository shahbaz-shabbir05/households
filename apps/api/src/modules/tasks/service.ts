/**
 * Tasks and chores.
 *
 * A chore is a task with `category: 'chore'` — see docs/01 for why this is one
 * module and not two.
 */

import {
  and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL,
} from 'drizzle-orm';
import type {
  CivilDate, CreateTaskInput, ListTasksQuery, Priority, TaskCategory, TaskStatus, UpdateTaskInput,
} from '@hms/shared';
import { householdMembers, tasks } from '../../db/schema/index.js';
import type { Database } from '../../db/client.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { diffFields, writeAudit } from '../../core/audit.js';
import { assertCan, can } from '../../core/policy/index.js';
import type { RequestContext } from '../../core/request-context.js';
import { todayIn } from '../../core/time.js';
import { offsetOf, paginated } from '../../core/pagination.js';
import { createSeries, deactivateSeries, endSeries } from '../../core/series.js';
import type { Materialiser } from '../../core/recurrence-service.js';

export interface TaskView {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  category: TaskCategory;
  assigneeMemberId: string | null;
  assigneeName: string | null;
  dueDate: CivilDate | null;
  dueTime: string | null;
  startDate: CivilDate | null;
  estimatedMinutes: number | null;
  completedAt: string | null;
  completedByMemberId: string | null;
  notes: string | null;
  isRecurring: boolean;
  seriesId: string | null;
  occurrenceDate: CivilDate | null;
  isOverdue: boolean;
  createdAt: string;
}

/** Fields the recurrence engine copies onto each generated task. */
interface TaskTemplate {
  title: string;
  description?: string | null;
  priority: Priority;
  category: TaskCategory;
  assigneeMemberId?: string | null;
  createdByMemberId?: string | null;
  dueTime?: string | null;
  estimatedMinutes?: number | null;
  notes?: string | null;
  createdBy?: string | null;
}

export class TaskService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * The materialiser the recurrence engine calls. It only ever inserts, so a
   * user's edit to one occurrence is never overwritten by a later run.
   */
  readonly materialiser: Materialiser = async ({ db, householdId, seriesId, occurrenceDate, template }) => {
    const t = template as unknown as TaskTemplate;
    const [row] = await db
      .insert(tasks)
      .values({
        householdId,
        title: t.title,
        description: t.description ?? null,
        priority: t.priority,
        category: t.category,
        assigneeMemberId: t.assigneeMemberId ?? null,
        createdByMemberId: t.createdByMemberId ?? null,
        dueDate: occurrenceDate,
        dueTime: t.dueTime ?? null,
        estimatedMinutes: t.estimatedMinutes ?? null,
        notes: t.notes ?? null,
        seriesId,
        occurrenceDate,
        createdBy: t.createdBy ?? null,
      })
      .returning({ id: tasks.id });
    return row!.id;
  };

  async list(ctx: RequestContext, query: ListTasksQuery) {
    assertCan(ctx, 'task:read');
    const today = todayIn(ctx.household.timezone, this.now());

    const where = and(
      eq(tasks.householdId, ctx.household.id),
      isNull(tasks.deletedAt),
      ...this.visibilityFilter(ctx),
      ...this.queryFilters(ctx, query, today),
    );

    const orderColumn = {
      dueDate: tasks.dueDate,
      priority: tasks.priority,
      createdAt: tasks.createdAt,
      title: tasks.title,
    }[query.sort];

    const [rows, totals] = await Promise.all([
      this.db
        .select({ task: tasks, assigneeName: householdMembers.displayName })
        .from(tasks)
        .leftJoin(householdMembers, eq(householdMembers.id, tasks.assigneeMemberId))
        .where(where)
        .orderBy(query.order === 'asc' ? asc(orderColumn) : desc(orderColumn), desc(tasks.createdAt))
        .limit(query.perPage)
        .offset(offsetOf(query)),
      this.db.select({ value: count() }).from(tasks).where(where),
    ]);

    return paginated(
      rows.map((r) => toView(r.task, r.assigneeName, today)),
      totals[0]?.value ?? 0,
      query,
    );
  }

  async get(ctx: RequestContext, taskId: string): Promise<TaskView> {
    assertCan(ctx, 'task:read');
    const row = await this.find(ctx, taskId);
    assertCan(ctx, 'task:read', policySubject(row));
    return toView(
      row,
      await this.assigneeName(row.assigneeMemberId),
      todayIn(ctx.household.timezone, this.now()),
    );
  }

  async create(ctx: RequestContext, input: CreateTaskInput): Promise<TaskView> {
    assertCan(ctx, 'task:create');
    await this.assertAssigneeExists(ctx, input.assigneeMemberId);

    const today = todayIn(ctx.household.timezone, this.now());

    const created = await this.db.transaction(async (tx) => {
      if (input.recurrence) {
        const template: TaskTemplate = {
          title: input.title,
          description: input.description ?? null,
          priority: input.priority,
          category: input.category,
          assigneeMemberId: input.assigneeMemberId ?? null,
          createdByMemberId: ctx.member.id,
          dueTime: input.dueTime ?? null,
          estimatedMinutes: input.estimatedMinutes ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
        };

        const { seriesId } = await createSeries(
          tx,
          {
            householdId: ctx.household.id,
            entityType: 'task',
            rule: input.recurrence,
            template: template as unknown as Record<string, unknown>,
            anchorDate: input.dueDate!,
            timezone: ctx.household.timezone,
          },
          this.materialiser,
          this.now(),
        );

        // Return the first occurrence — that is what the user just described.
        const first = await tx.query.tasks.findFirst({
          where: eq(tasks.seriesId, seriesId),
          orderBy: asc(tasks.occurrenceDate),
        });
        if (!first) {
          throw new ValidationError('That repeat rule produces no dates — check the end date', [
            { path: 'recurrence', message: 'No occurrences' },
          ]);
        }

        await writeAudit(tx, ctx, {
          entityType: 'task',
          entityId: first.id,
          action: 'create',
          summary: `Created repeating task "${input.title}"`,
        });
        return first;
      }

      const [row] = await tx
        .insert(tasks)
        .values({
          householdId: ctx.household.id,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority,
          category: input.category,
          assigneeMemberId: input.assigneeMemberId ?? null,
          createdByMemberId: ctx.member.id,
          dueDate: input.dueDate ?? null,
          dueTime: input.dueTime ?? null,
          startDate: input.startDate ?? null,
          estimatedMinutes: input.estimatedMinutes ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();

      await writeAudit(tx, ctx, {
        entityType: 'task',
        entityId: row!.id,
        action: 'create',
        summary: `Created task "${row!.title}"`,
      });
      return row!;
    });

    return toView(created, await this.assigneeName(created.assigneeMemberId), today);
  }

  async update(ctx: RequestContext, taskId: string, input: UpdateTaskInput): Promise<TaskView> {
    const existing = await this.find(ctx, taskId);
    assertCan(ctx, 'task:update', policySubject(existing));
    await this.assertAssigneeExists(ctx, input.assigneeMemberId);

    const today = todayIn(ctx.household.timezone, this.now());
    const now = this.now();

    const updated = await this.db.transaction(async (tx) => {
      const changes = diffFields(existing as unknown as Record<string, unknown>, input);
      if (!changes) return existing;

      // Completion state and its bookkeeping move together, or the
      // tasks_completed_chk constraint rejects the row.
      const completion =
        input.status === undefined || input.status === existing.status
          ? {}
          : input.status === 'completed'
            ? { completedAt: now, completedByMemberId: ctx.member.id }
            : { completedAt: null, completedByMemberId: null };

      const [row] = await tx
        .update(tasks)
        .set({
          ...input,
          ...completion,
          // Editing one occurrence detaches it, so regeneration leaves it alone.
          ...(existing.seriesId ? { isDetached: true } : {}),
          updatedBy: ctx.user.id,
          updatedAt: now,
        })
        .where(eq(tasks.id, taskId))
        .returning();

      await writeAudit(tx, ctx, { entityType: 'task', entityId: taskId, action: 'update', changes });
      return row!;
    });

    return toView(updated, await this.assigneeName(updated.assigneeMemberId), today);
  }

  /** The one-tap dashboard action. Idempotent: ticking twice is not an error. */
  async setCompleted(ctx: RequestContext, taskId: string, completed: boolean): Promise<TaskView> {
    const existing = await this.find(ctx, taskId);
    assertCan(ctx, 'task:complete', policySubject(existing));

    const today = todayIn(ctx.household.timezone, this.now());
    const now = this.now();
    const nextStatus: TaskStatus = completed ? 'completed' : 'pending';

    if (existing.status === nextStatus) {
      return toView(existing, await this.assigneeName(existing.assigneeMemberId), today);
    }

    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(tasks)
        .set({
          status: nextStatus,
          completedAt: completed ? now : null,
          completedByMemberId: completed ? ctx.member.id : null,
          updatedBy: ctx.user.id,
          updatedAt: now,
        })
        .where(eq(tasks.id, taskId))
        .returning();

      await writeAudit(tx, ctx, {
        entityType: 'task',
        entityId: taskId,
        action: 'update',
        summary: completed ? `Completed "${existing.title}"` : `Reopened "${existing.title}"`,
        changes: { status: { from: existing.status, to: nextStatus } },
      });
      return row!;
    });

    return toView(updated, await this.assigneeName(updated.assigneeMemberId), today);
  }

  /**
   * Soft-deletes. For a repeating task the caller chooses whether this affects
   * only this occurrence or the rest of the series (docs/08).
   */
  async remove(ctx: RequestContext, taskId: string, scope: 'occurrence' | 'following'): Promise<void> {
    const existing = await this.find(ctx, taskId);
    assertCan(ctx, 'task:delete', policySubject(existing));
    const now = this.now();

    await this.db.transaction(async (tx) => {
      await tx.update(tasks).set({ deletedAt: now, updatedBy: ctx.user.id }).where(eq(tasks.id, taskId));

      if (existing.seriesId && scope === 'following') {
        const from = existing.occurrenceDate ?? existing.dueDate ?? todayIn(ctx.household.timezone, now);
        // End the rule here, then clear the not-yet-done occurrences ahead of
        // it. Completed ones are history and are left alone.
        await endSeries(tx, existing.seriesId, from);
        await tx
          .update(tasks)
          .set({ deletedAt: now, updatedBy: ctx.user.id })
          .where(
            and(
              eq(tasks.seriesId, existing.seriesId),
              isNull(tasks.deletedAt),
              inArray(tasks.status, ['pending', 'in_progress']),
              gte(tasks.occurrenceDate, from),
            ),
          );
      }

      await writeAudit(tx, ctx, {
        entityType: 'task',
        entityId: taskId,
        action: 'delete',
        summary:
          existing.seriesId && scope === 'following'
            ? `Deleted "${existing.title}" and future repeats`
            : `Deleted "${existing.title}"`,
      });
    });
  }

  /** Stops a series without touching the occurrences already generated. */
  async stopRecurrence(ctx: RequestContext, taskId: string): Promise<void> {
    const existing = await this.find(ctx, taskId);
    assertCan(ctx, 'task:update', policySubject(existing));
    if (!existing.seriesId) {
      throw new ValidationError('That task does not repeat');
    }

    await this.db.transaction(async (tx) => {
      await deactivateSeries(tx, existing.seriesId!);
      await writeAudit(tx, ctx, {
        entityType: 'task',
        entityId: taskId,
        action: 'update',
        summary: `Stopped repeating "${existing.title}"`,
      });
    });
  }

  private queryFilters(ctx: RequestContext, query: ListTasksQuery, today: CivilDate): SQL[] {
    const filters: SQL[] = [];

    if (query.status) filters.push(eq(tasks.status, query.status));
    if (query.open) filters.push(inArray(tasks.status, ['pending', 'in_progress']));
    if (query.category) filters.push(eq(tasks.category, query.category));
    if (query.priority) filters.push(eq(tasks.priority, query.priority));

    const assignee = query.assignee === 'me' ? ctx.member.id : query.assigneeMemberId;
    if (assignee) filters.push(eq(tasks.assigneeMemberId, assignee));

    if (query.dueBefore) filters.push(lte(tasks.dueDate, query.dueBefore));
    if (query.dueAfter) filters.push(gte(tasks.dueDate, query.dueAfter));

    if (query.overdue) {
      filters.push(
        and(
          isNotNull(tasks.dueDate),
          sql`${tasks.dueDate} < ${today}`,
          inArray(tasks.status, ['pending', 'in_progress']),
        )!,
      );
    }

    if (query.search) {
      // Escaped, so a literal % or _ typed into a search box is not a wildcard.
      const term = `%${query.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      filters.push(or(ilike(tasks.title, term), ilike(tasks.description, term))!);
    }

    return filters;
  }

  /**
   * Narrows the query for roles that may only see some tasks, so a restricted
   * member never pages through rows they are not allowed to read.
   */
  private visibilityFilter(ctx: RequestContext): SQL[] {
    // A probe with a member id that is nobody: only a role scoped to `all`
    // can read a task belonging to someone else.
    if (can(ctx, 'task:read', { assigneeMemberId: '00000000-0000-0000-0000-000000000000' })) {
      return [];
    }
    return [or(eq(tasks.assigneeMemberId, ctx.member.id), eq(tasks.createdByMemberId, ctx.member.id))!];
  }

  private async find(ctx: RequestContext, taskId: string) {
    const row = await this.db.query.tasks.findFirst({
      where: and(eq(tasks.id, taskId), eq(tasks.householdId, ctx.household.id), isNull(tasks.deletedAt)),
    });
    if (!row) throw new NotFoundError('Task');
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

  /** An assignee must be a real, non-deleted member of *this* household. */
  private async assertAssigneeExists(ctx: RequestContext, memberId: string | null | undefined): Promise<void> {
    if (!memberId) return;
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
        { path: 'assigneeMemberId', message: 'Unknown member' },
      ]);
    }
  }
}

function policySubject(row: typeof tasks.$inferSelect) {
  return { assigneeMemberId: row.assigneeMemberId, createdByMemberId: row.createdByMemberId };
}

function toView(row: typeof tasks.$inferSelect, assigneeName: string | null, today: CivilDate): TaskView {
  const open = row.status === 'pending' || row.status === 'in_progress';
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    category: row.category,
    assigneeMemberId: row.assigneeMemberId,
    assigneeName,
    dueDate: row.dueDate,
    dueTime: row.dueTime,
    startDate: row.startDate,
    estimatedMinutes: row.estimatedMinutes,
    completedAt: row.completedAt?.toISOString() ?? null,
    completedByMemberId: row.completedByMemberId,
    notes: row.notes,
    isRecurring: row.seriesId !== null,
    seriesId: row.seriesId,
    occurrenceDate: row.occurrenceDate,
    isOverdue: Boolean(open && row.dueDate && row.dueDate < today),
    createdAt: row.createdAt.toISOString(),
  };
}
