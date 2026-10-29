/**
 * Creating and retiring recurring series.
 *
 * Shared by every module that recurs, so the rule row, the series row and the
 * first materialisation happen the same way everywhere (docs/08).
 */

import { eq } from 'drizzle-orm';
import type { CivilDate, EntityType, RecurrenceRuleInput } from '@hms/shared';
import { recurrenceRules, recurringSeries } from '../db/schema/index.js';
import type { DbExecutor } from '../db/client.js';
import { generateForSeries, type Materialiser, type SeriesRow } from './recurrence-service.js';

export interface CreateSeriesInput {
  householdId: string;
  entityType: EntityType;
  rule: RecurrenceRuleInput;
  /** Validated by the owning module's schema before it gets here. */
  template: Record<string, unknown>;
  anchorDate: CivilDate;
  timezone: string;
}

/**
 * Creates the rule and series, then materialises the first horizon of
 * occurrences immediately — so a user who sets up "rent on the 1st" can see
 * the next few months right away rather than waiting for a job tick.
 */
export async function createSeries(
  db: DbExecutor,
  input: CreateSeriesInput,
  materialiser: Materialiser,
  now: Date = new Date(),
): Promise<{ seriesId: string; created: number }> {
  const [rule] = await db
    .insert(recurrenceRules)
    .values({
      householdId: input.householdId,
      freq: input.rule.freq,
      interval: input.rule.interval,
      byWeekday: input.rule.byWeekday ?? null,
      byMonthday: input.rule.byMonthday ?? null,
      byMonth: input.rule.byMonth ?? null,
      until: input.rule.until ?? null,
      count: input.rule.count ?? null,
    })
    .returning();

  const [series] = await db
    .insert(recurringSeries)
    .values({
      householdId: input.householdId,
      entityType: input.entityType,
      recurrenceRuleId: rule!.id,
      template: input.template,
      anchorDate: input.anchorDate,
    })
    .returning();

  const row: SeriesRow = {
    id: series!.id,
    householdId: input.householdId,
    entityType: input.entityType,
    template: input.template,
    anchorDate: input.anchorDate,
    generateThrough: null,
    lastGeneratedOn: null,
    timezone: input.timezone,
    rule: {
      freq: input.rule.freq,
      interval: input.rule.interval,
      ...(input.rule.byWeekday ? { byWeekday: input.rule.byWeekday } : {}),
      ...(input.rule.byMonthday ? { byMonthday: input.rule.byMonthday } : {}),
      ...(input.rule.byMonth ? { byMonth: input.rule.byMonth } : {}),
      ...(input.rule.until ? { until: input.rule.until } : {}),
      ...(input.rule.count ? { count: input.rule.count } : {}),
    },
  };

  const created = await generateForSeries(db, row, materialiser, now);
  return { seriesId: series!.id, created };
}

/**
 * Ends a series from a given date. Occurrences already generated before that
 * date are left alone: they are history, and rewriting history is exactly the
 * behaviour the recurrence design exists to prevent.
 */
export async function endSeries(
  db: DbExecutor,
  seriesId: string,
  until: CivilDate,
): Promise<void> {
  const series = await db.query.recurringSeries.findFirst({
    where: eq(recurringSeries.id, seriesId),
    columns: { recurrenceRuleId: true },
  });
  if (!series) return;

  await db.update(recurrenceRules).set({ until, count: null }).where(eq(recurrenceRules.id, series.recurrenceRuleId));
  await db.update(recurringSeries).set({ isActive: false }).where(eq(recurringSeries.id, seriesId));
}

export async function deactivateSeries(db: DbExecutor, seriesId: string): Promise<void> {
  await db.update(recurringSeries).set({ isActive: false }).where(eq(recurringSeries.id, seriesId));
}
