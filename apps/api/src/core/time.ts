/**
 * Household-timezone time handling.
 *
 * Every "today", "due", "this week" question in the product is answered here,
 * so there is exactly one place where a timezone mistake can be made — and one
 * place to test. Handlers never do their own date maths (docs/05).
 *
 * Instants are stored as `timestamptz` (UTC). Calendar values are civil dates.
 * The conversion between them always needs a timezone, which is why every
 * function takes one explicitly rather than falling back to the server's.
 */

import { addDays, startOfWeek, type CivilDate } from '@hms/shared';

/** The current civil date in a given timezone. */
export function todayIn(timezone: string, now: Date = new Date()): CivilDate {
  return civilDateIn(now, timezone);
}

/** The civil date an instant falls on, in a given timezone. */
export function civilDateIn(instant: Date, timezone: string): CivilDate {
  // `en-CA` formats as YYYY-MM-DD, which is exactly the civil-date shape.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** The wall-clock time `HH:MM` an instant falls on, in a given timezone. */
export function timeOfDayIn(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}

/**
 * Converts a civil date plus a wall-clock time in a timezone into a UTC instant.
 *
 * Implemented by probing: guess UTC, measure how the target zone renders that
 * guess, and correct by the difference. Two passes settle DST boundaries, which
 * is why this is not simply `new Date(...)`.
 */
export function instantFrom(date: CivilDate, time: string, timezone: string): Date {
  const [hh, mm] = time.split(':').map(Number);
  const [y, m, d] = date.split('-').map(Number);
  const wanted = Date.UTC(y!, m! - 1, d!, hh ?? 0, mm ?? 0, 0, 0);

  let guess = wanted;
  for (let pass = 0; pass < 2; pass += 1) {
    const offset = zoneOffsetMs(new Date(guess), timezone);
    const next = wanted - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/** How far ahead of UTC the zone is, in milliseconds, at a given instant. */
function zoneOffsetMs(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - instant.getTime();
}

export interface DateWindow {
  from: CivilDate;
  to: CivilDate;
}

/** The civil-date window the dashboard's "this week" section covers. */
export function weekWindow(
  timezone: string,
  weekStartsOn: 0 | 1 = 1,
  now: Date = new Date(),
): DateWindow {
  const today = todayIn(timezone, now);
  const from = startOfWeek(today, weekStartsOn);
  return { from, to: addDays(from, 6) };
}

/** A rolling window from today to N days ahead — what "upcoming" means. */
export function upcomingWindow(timezone: string, days: number, now: Date = new Date()): DateWindow {
  const today = todayIn(timezone, now);
  return { from: today, to: addDays(today, days) };
}

/**
 * Whether an instant falls inside a household's quiet hours. Windows that wrap
 * midnight (22:00–07:00, the default) are the normal case, not the exception.
 */
export function isWithinQuietHours(
  instant: Date,
  timezone: string,
  start: string | null,
  end: string | null,
): boolean {
  if (!start || !end) return false;
  const now = timeOfDayIn(instant, timezone);
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

/** The next instant at which quiet hours end — when a deferred notification may go out. */
export function nextQuietHoursEnd(instant: Date, timezone: string, end: string): Date {
  const today = civilDateIn(instant, timezone);
  const candidate = instantFrom(today, end, timezone);
  return candidate > instant ? candidate : instantFrom(addDays(today, 1), end, timezone);
}
