/**
 * Civil (calendar) date utilities.
 *
 * A "civil date" is a timezone-free calendar date in `YYYY-MM-DD` form — the
 * same thing Postgres stores in a `date` column. Recurrence, due dates and
 * billing periods are all civil dates: "rent is due on the 1st" is true
 * regardless of timezone.
 *
 * All arithmetic goes through `Date.UTC`, never the local-time `Date`
 * constructor, so results never shift with the server's timezone. Converting a
 * civil date + time-of-day into an actual instant is a separate concern and
 * lives in the API's `core/time` module, where the household timezone is known.
 */

export type CivilDate = string; // YYYY-MM-DD

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCivilDate(value: unknown): value is CivilDate {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function toCivilDate(date: Date): CivilDate {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return `${pad4(y)}-${pad2(m)}-${pad2(d)}`;
}

/** Parses a civil date into a UTC-midnight Date, used only as an arithmetic vehicle. */
export function fromCivilDate(value: CivilDate): Date {
  const m = ISO_DATE.exec(value);
  if (!m) throw new RangeError(`Invalid civil date: ${value}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function civilParts(value: CivilDate): { year: number; month: number; day: number } {
  const m = ISO_DATE.exec(value);
  if (!m) throw new RangeError(`Invalid civil date: ${value}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function makeCivilDate(year: number, month: number, day: number): CivilDate {
  return toCivilDate(new Date(Date.UTC(year, month - 1, day)));
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(value: CivilDate, days: number): CivilDate {
  const d = fromCivilDate(value);
  d.setUTCDate(d.getUTCDate() + days);
  return toCivilDate(d);
}

/**
 * Adds months, clamping the day to the end of the target month.
 * 2026-01-31 + 1 month = 2026-02-28, not 2026-03-03. Clamping (rather than
 * skipping or overflowing) means a monthly rent bill still appears in February.
 */
export function addMonths(value: CivilDate, months: number): CivilDate {
  const { year, month, day } = civilParts(value);
  const total = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = (total % 12) + 1;
  return makeCivilDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

export function addYears(value: CivilDate, years: number): CivilDate {
  const { year, month, day } = civilParts(value);
  return makeCivilDate(year + years, month, Math.min(day, daysInMonth(year + years, month)));
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(value: CivilDate): number {
  return fromCivilDate(value).getUTCDay();
}

export function compareCivilDates(a: CivilDate, b: CivilDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function diffInDays(from: CivilDate, to: CivilDate): number {
  const ms = fromCivilDate(to).getTime() - fromCivilDate(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** Start of the week containing `value`. `weekStartsOn` is 0=Sun (default) or 1=Mon. */
export function startOfWeek(value: CivilDate, weekStartsOn: 0 | 1 = 1): CivilDate {
  const offset = (weekdayOf(value) - weekStartsOn + 7) % 7;
  return addDays(value, -offset);
}

export function startOfMonth(value: CivilDate): CivilDate {
  const { year, month } = civilParts(value);
  return makeCivilDate(year, month, 1);
}

export function endOfMonth(value: CivilDate): CivilDate {
  const { year, month } = civilParts(value);
  return makeCivilDate(year, month, daysInMonth(year, month));
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function pad4(n: number): string {
  return String(n).padStart(4, '0');
}
