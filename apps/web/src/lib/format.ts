/**
 * Display formatting. Kept in one place so "Today", "Overdue by 3 days" and
 * money render identically everywhere.
 */

import { addDays, diffInDays, type CivilDate } from '@hms/shared';
import { formatMoney } from '@hms/shared';

export { formatMoney };

/** The household's current civil date, computed in its timezone. */
export function todayIn(timezone: string, now = new Date()): CivilDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * A date the way a person would say it: "Today", "Tomorrow", "Friday", then a
 * full date once it is far enough away to need one.
 */
export function friendlyDate(date: CivilDate, today: CivilDate, locale = 'en-PK'): string {
  const delta = diffInDays(today, date);

  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  if (delta > 1 && delta < 7) {
    return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(asUtc(date));
  }
  if (delta < 0) return `${Math.abs(delta)} days ago`;

  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(isDifferentYear(date, today) ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(asUtc(date));
}

export function longDate(date: CivilDate, locale = 'en-PK'): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(asUtc(date));
}

export function monthLabel(date: CivilDate, locale = 'en-PK'): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    asUtc(date),
  );
}

/** "14:30" → "2:30 pm", respecting the locale's clock convention. */
export function friendlyTime(time: string, locale = 'en-PK'): string {
  const [hh, mm] = time.split(':').map(Number);
  const date = new Date(Date.UTC(2000, 0, 1, hh ?? 0, mm ?? 0));
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

/** How late something is, phrased for a person rather than a log file. */
export function overdueLabel(date: CivilDate, today: CivilDate): string {
  const days = diffInDays(date, today);
  if (days <= 0) return '';
  if (days === 1) return 'Overdue by 1 day';
  if (days < 30) return `Overdue by ${days} days`;
  return 'Long overdue';
}

export function relativeDayOptions(today: CivilDate): Array<{ label: string; value: CivilDate }> {
  return [
    { label: 'Today', value: today },
    { label: 'Tomorrow', value: addDays(today, 1) },
    { label: 'This week', value: addDays(today, 7) },
  ];
}

function asUtc(date: CivilDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

function isDifferentYear(a: CivilDate, b: CivilDate): boolean {
  return a.slice(0, 4) !== b.slice(0, 4);
}
