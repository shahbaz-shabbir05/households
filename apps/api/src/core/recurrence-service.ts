/**
 * The recurrence generator: turns a `recurring_series` row into concrete
 * entity rows, exactly once per occurrence date (docs/08).
 *
 * Duplicates are prevented by a unique constraint on
 * `series_occurrences (series_id, occurrence_date)` rather than by careful
 * code, so concurrent runs, retries and crashes all converge on one row.
 */

import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import {
  addDays,
  expandOccurrences,
  type CivilDate,
  type EntityType,
  type RecurrenceRule,
} from '@hms/shared';
import { recurrenceRules, recurringSeries, seriesOccurrences } from '../db/schema/index.js';
import type { Database, DbExecutor } from '../db/client.js';
import { PG_UNIQUE_VIOLATION, pgErrorCode } from './errors.js';
import { todayIn } from './time.js';

/** How far ahead occurrences are materialised. Yearly rules need a longer view. */
export const DEFAULT_HORIZON_DAYS = 90;
export const YEARLY_HORIZON_DAYS = 400;

export interface MaterialiseArgs {
  db: DbExecutor;
  householdId: string;
  seriesId: string;
  occurrenceDate: CivilDate;
  template: Record<string, unknown>;
}

/**
 * A module registers one of these to say how its entity is created from a
 * template. It returns the new row's id, which is recorded in the ledger.
 */
export type Materialiser = (args: MaterialiseArgs) => Promise<string>;

export class MaterialiserRegistry {
  private readonly map = new Map<EntityType, Materialiser>();

  register(entityType: EntityType, materialiser: Materialiser): this {
    this.map.set(entityType, materialiser);
    return this;
  }

  get(entityType: EntityType): Materialiser | undefined {
    return this.map.get(entityType);
  }
}

export interface SeriesRow {
  id: string;
  householdId: string;
  entityType: EntityType;
  template: Record<string, unknown>;
  anchorDate: CivilDate;
  generateThrough: CivilDate | null;
  lastGeneratedOn: CivilDate | null;
  rule: RecurrenceRule;
  timezone: string;
}

/**
 * Generates every missing occurrence for one series, up to its horizon.
 *
 * The generator only ever *inserts*. It never updates an existing occurrence,
 * so a user's edit to this month's bill is never overwritten by a later run —
 * a classic and very confusing bug this rule eliminates.
 */
export async function generateForSeries(
  db: DbExecutor,
  series: SeriesRow,
  materialiser: Materialiser,
  now: Date = new Date(),
): Promise<number> {
  const today = todayIn(series.timezone, now);
  const horizonDays = series.rule.freq === 'yearly' ? YEARLY_HORIZON_DAYS : DEFAULT_HORIZON_DAYS;
  const generateThrough = addDays(today, horizonDays);

  // Catch-up window: past occurrences still matter for tasks and bills (an
  // unpaid bill from last Tuesday must exist), but we never reach back further
  // than the series has already been generated.
  const from = series.lastGeneratedOn ?? series.anchorDate;

  const dates = expandOccurrences(series.rule, series.anchorDate, {
    from,
    to: generateThrough,
    limit: 500,
  });

  let created = 0;
  for (const occurrenceDate of dates) {
    const inserted = await claimOccurrence(db, series.id, occurrenceDate);
    if (!inserted) continue;

    const entityId = await materialiser({
      db,
      householdId: series.householdId,
      seriesId: series.id,
      occurrenceDate,
      template: series.template,
    });

    await db
      .update(seriesOccurrences)
      .set({ entityId })
      .where(eq(seriesOccurrences.id, inserted));
    created += 1;
  }

  await db
    .update(recurringSeries)
    .set({ lastGeneratedOn: today, generateThrough, updatedAt: now })
    .where(eq(recurringSeries.id, series.id));

  return created;
}

/**
 * Claims one occurrence date. Returns the ledger row id if this caller won the
 * race, or null if the occurrence already exists or was deliberately skipped.
 */
async function claimOccurrence(
  db: DbExecutor,
  seriesId: string,
  occurrenceDate: CivilDate,
): Promise<string | null> {
  try {
    const [row] = await db
      .insert(seriesOccurrences)
      .values({ seriesId, occurrenceDate })
      .onConflictDoNothing({ target: [seriesOccurrences.seriesId, seriesOccurrences.occurrenceDate] })
      .returning({ id: seriesOccurrences.id });
    return row?.id ?? null;
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) return null;
    throw error;
  }
}

/** Loads series that are due for generation, joined to their rule and household timezone. */
export async function loadSeriesDueForGeneration(
  db: Database,
  today: CivilDate,
  limit = 200,
): Promise<SeriesRow[]> {
  const rows = await db
    .select({
      id: recurringSeries.id,
      householdId: recurringSeries.householdId,
      entityType: recurringSeries.entityType,
      template: recurringSeries.template,
      anchorDate: recurringSeries.anchorDate,
      generateThrough: recurringSeries.generateThrough,
      lastGeneratedOn: recurringSeries.lastGeneratedOn,
      freq: recurrenceRules.freq,
      interval: recurrenceRules.interval,
      byWeekday: recurrenceRules.byWeekday,
      byMonthday: recurrenceRules.byMonthday,
      byMonth: recurrenceRules.byMonth,
      until: recurrenceRules.until,
      count: recurrenceRules.count,
      timezone: sql<string>`households.timezone`,
    })
    .from(recurringSeries)
    .innerJoin(recurrenceRules, eq(recurrenceRules.id, recurringSeries.recurrenceRuleId))
    .innerJoin(sql`households`, sql`households.id = ${recurringSeries.householdId}`)
    .where(
      and(
        eq(recurringSeries.isActive, true),
        // Not yet generated, or generated on an earlier day.
        or(isNull(recurringSeries.lastGeneratedOn), lte(recurringSeries.lastGeneratedOn, today)),
      ),
    )
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    householdId: r.householdId,
    entityType: r.entityType,
    template: r.template,
    anchorDate: r.anchorDate,
    generateThrough: r.generateThrough,
    lastGeneratedOn: r.lastGeneratedOn,
    timezone: r.timezone,
    rule: {
      freq: r.freq,
      interval: r.interval,
      ...(r.byWeekday ? { byWeekday: r.byWeekday } : {}),
      ...(r.byMonthday ? { byMonthday: r.byMonthday } : {}),
      ...(r.byMonth ? { byMonth: r.byMonth } : {}),
      ...(r.until ? { until: r.until } : {}),
      ...(r.count ? { count: r.count } : {}),
    },
  }));
}
