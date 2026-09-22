/**
 * The recurrence engine.
 *
 * One implementation serves every recurring thing in the product (tasks, bills,
 * events, reminders, maintenance, medicine doses). See docs/08-recurrence.md
 * for why this is a single engine rather than per-module logic.
 *
 * Scope is an RFC 5545 subset: freq + interval + byWeekday/byMonthday/byMonth,
 * bounded by `until` or `count`. Full iCal (BYSETPOS, EXDATE, RRULE strings) is
 * deliberately out of scope — a large surface nobody in a family app uses, and
 * a well-known source of bugs.
 *
 * This module is pure: civil dates in, civil dates out, no clock, no I/O. That
 * is what makes ~40 edge cases cheap to test.
 */

import {
  type CivilDate,
  addDays,
  addMonths,
  addYears,
  civilParts,
  compareCivilDates,
  daysInMonth,
  makeCivilDate,
  startOfWeek,
  weekdayOf,
} from './civil-date.js';

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  /** Repeat every N periods. Must be >= 1. */
  interval: number;
  /** 0=Sun..6=Sat. Weekly only. Defaults to the anchor's weekday. */
  byWeekday?: number[];
  /** 1..31, or -1 for "last day of month". Monthly/yearly. Defaults to the anchor's day. */
  byMonthday?: number[];
  /** 1..12. Yearly only. Defaults to the anchor's month. */
  byMonth?: number[];
  /** Inclusive end date. Mutually exclusive with `count`. */
  until?: CivilDate;
  /** Total number of occurrences from the anchor. Mutually exclusive with `until`. */
  count?: number;
}

export interface ExpandOptions {
  /** Only return occurrences on or after this date. Does not affect `count`. */
  from?: CivilDate;
  /** Only return occurrences on or before this date. */
  to?: CivilDate;
  /** Hard cap on returned occurrences. */
  limit?: number;
}

/** Safety valve: stops a malformed rule from looping forever. */
const MAX_ITERATIONS = 10_000;
const DEFAULT_LIMIT = 500;

export class InvalidRecurrenceRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecurrenceRuleError';
  }
}

export function validateRecurrenceRule(rule: RecurrenceRule): void {
  if (!Number.isInteger(rule.interval) || rule.interval < 1) {
    throw new InvalidRecurrenceRuleError('interval must be an integer >= 1');
  }
  if (rule.until !== undefined && rule.count !== undefined) {
    throw new InvalidRecurrenceRuleError('a rule may set `until` or `count`, not both');
  }
  if (rule.count !== undefined && (!Number.isInteger(rule.count) || rule.count < 1)) {
    throw new InvalidRecurrenceRuleError('count must be an integer >= 1');
  }
  if (rule.byWeekday?.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new InvalidRecurrenceRuleError('byWeekday values must be integers 0..6');
  }
  if (rule.byMonthday?.some((d) => !Number.isInteger(d) || d === 0 || d < -1 || d > 31)) {
    throw new InvalidRecurrenceRuleError('byMonthday values must be 1..31 or -1');
  }
  if (rule.byMonth?.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) {
    throw new InvalidRecurrenceRuleError('byMonth values must be integers 1..12');
  }
  if (rule.freq !== 'weekly' && rule.byWeekday?.length) {
    throw new InvalidRecurrenceRuleError('byWeekday is only supported for weekly rules');
  }
  if (rule.freq === 'daily' && rule.byMonthday?.length) {
    throw new InvalidRecurrenceRuleError('byMonthday is not supported for daily rules');
  }
  if (rule.freq !== 'yearly' && rule.byMonth?.length) {
    throw new InvalidRecurrenceRuleError('byMonth is only supported for yearly rules');
  }
}

/**
 * Expands a rule into concrete civil dates.
 *
 * Expansion always starts at `anchor` and walks forward, because `count` is
 * defined relative to the start of the series — a window cannot be computed
 * without knowing how many occurrences preceded it. `from`/`to` filter the
 * result; they never change which occurrences exist.
 */
export function expandOccurrences(
  rule: RecurrenceRule,
  anchor: CivilDate,
  options: ExpandOptions = {},
): CivilDate[] {
  validateRecurrenceRule(rule);

  const limit = options.limit ?? DEFAULT_LIMIT;
  const results: CivilDate[] = [];
  let emitted = 0;
  let iterations = 0;

  for (const date of walk(rule, anchor)) {
    if (++iterations > MAX_ITERATIONS) break;

    if (rule.until && compareCivilDates(date, rule.until) > 0) break;
    if (rule.count !== undefined && emitted >= rule.count) break;
    emitted += 1;

    if (options.to && compareCivilDates(date, options.to) > 0) break;
    if (options.from && compareCivilDates(date, options.from) < 0) continue;

    results.push(date);
    if (results.length >= limit) break;
  }

  return results;
}

/** The first occurrence strictly after `after`, or null if the series has ended. */
export function nextOccurrence(
  rule: RecurrenceRule,
  anchor: CivilDate,
  after: CivilDate,
): CivilDate | null {
  const [next] = expandOccurrences(rule, anchor, { from: addDays(after, 1), limit: 1 });
  return next ?? null;
}

/**
 * The occurrence generator. Yields candidate dates in ascending order, without
 * applying `until`/`count`/window bounds — those are the caller's job so that
 * `count` semantics stay in one place.
 */
function* walk(rule: RecurrenceRule, anchor: CivilDate): Generator<CivilDate> {
  switch (rule.freq) {
    case 'daily':
      yield* walkDaily(rule, anchor);
      return;
    case 'weekly':
      yield* walkWeekly(rule, anchor);
      return;
    case 'monthly':
      yield* walkMonthly(rule, anchor);
      return;
    case 'yearly':
      yield* walkYearly(rule, anchor);
      return;
  }
}

function* walkDaily(rule: RecurrenceRule, anchor: CivilDate): Generator<CivilDate> {
  let current = anchor;
  for (;;) {
    yield current;
    current = addDays(current, rule.interval);
  }
}

function* walkWeekly(rule: RecurrenceRule, anchor: CivilDate): Generator<CivilDate> {
  const weekdays = rule.byWeekday?.length
    ? [...new Set(rule.byWeekday)].sort((a, b) => a - b)
    : [weekdayOf(anchor)];

  // Weeks are anchored to the week containing the anchor date, so "every 2
  // weeks" means every second week *from the start*, not from an arbitrary epoch.
  let weekStart = startOfWeek(anchor, 1);
  for (;;) {
    for (const weekday of weekdays) {
      // Offset from Monday-based week start.
      const date = addDays(weekStart, (weekday - 1 + 7) % 7);
      // Occurrences before the anchor are not part of the series.
      if (compareCivilDates(date, anchor) >= 0) yield date;
    }
    weekStart = addDays(weekStart, 7 * rule.interval);
  }
}

function* walkMonthly(rule: RecurrenceRule, anchor: CivilDate): Generator<CivilDate> {
  const anchorDay = civilParts(anchor).day;
  const monthdays = rule.byMonthday?.length ? [...new Set(rule.byMonthday)] : [anchorDay];

  let cursor = anchor;
  for (;;) {
    const { year, month } = civilParts(cursor);
    const dates = resolveMonthdays(year, month, monthdays);
    for (const date of dates) {
      if (compareCivilDates(date, anchor) >= 0) yield date;
    }
    cursor = addMonths(makeCivilDate(year, month, 1), rule.interval);
  }
}

function* walkYearly(rule: RecurrenceRule, anchor: CivilDate): Generator<CivilDate> {
  const { month: anchorMonth, day: anchorDay } = civilParts(anchor);
  const months = rule.byMonth?.length ? [...new Set(rule.byMonth)].sort((a, b) => a - b) : [anchorMonth];
  const monthdays = rule.byMonthday?.length ? [...new Set(rule.byMonthday)] : [anchorDay];

  let year = civilParts(anchor).year;
  for (;;) {
    for (const month of months) {
      for (const date of resolveMonthdays(year, month, monthdays)) {
        if (compareCivilDates(date, anchor) >= 0) yield date;
      }
    }
    year += rule.interval;
    // `addYears` is not used here because we iterate whole years, not a date.
    if (year > 9000) return;
  }
}

/**
 * Turns monthday selectors into real dates for a given month, in ascending
 * order. `-1` means the last day. Days beyond the month's length clamp to the
 * last day rather than rolling into the next month or being skipped, so a
 * "31st of every month" bill still lands in February (docs/08).
 */
function resolveMonthdays(year: number, month: number, monthdays: number[]): CivilDate[] {
  const last = daysInMonth(year, month);
  const resolved = monthdays.map((d) => (d === -1 ? last : Math.min(d, last)));
  return [...new Set(resolved)].sort((a, b) => a - b).map((d) => makeCivilDate(year, month, d));
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINAL_SUFFIX = (n: number): string => {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
};

/** A human-readable summary for the UI, e.g. "Every 2 weeks on Monday, Friday". */
export function describeRecurrence(rule: RecurrenceRule): string {
  const every = rule.interval === 1 ? 'Every' : `Every ${rule.interval}`;
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rule.freq];
  const plural = rule.interval === 1 ? unit : `${unit}s`;

  let text = `${every} ${plural}`;

  if (rule.freq === 'weekly' && rule.byWeekday?.length) {
    const names = [...rule.byWeekday].sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d]);
    text += ` on ${formatList(names.filter((n): n is string => Boolean(n)))}`;
  }
  if ((rule.freq === 'monthly' || rule.freq === 'yearly') && rule.byMonthday?.length) {
    const days = rule.byMonthday.map((d) => (d === -1 ? 'the last day' : `the ${d}${ORDINAL_SUFFIX(d)}`));
    text += ` on ${formatList(days)}`;
  }
  if (rule.until) text += ` until ${rule.until}`;
  if (rule.count) text += `, ${rule.count} time${rule.count === 1 ? '' : 's'}`;

  return text;
}

function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
