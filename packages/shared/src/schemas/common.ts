import { z } from 'zod';
import { isCivilDate } from '../civil-date.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../api.js';

/** A `YYYY-MM-DD` calendar date, validated for real-calendar correctness (rejects 2026-02-30). */
export const civilDateSchema = z
  .string()
  .refine(isCivilDate, { message: 'Expected a valid calendar date in YYYY-MM-DD format' });

/** An ISO-8601 instant. */
export const instantSchema = z.string().datetime({ offset: true });

export const uuidSchema = z.string().uuid();

/** `HH:MM` in 24-hour form. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time in HH:MM format');

/**
 * Optional date/time fields, as an HTML form actually submits them.
 *
 * An untouched `<input type="date">` submits an empty string, not `undefined`.
 * Without this, every optional date on every create form fails validation the
 * first time a user leaves it blank — so the contract accepts what the platform
 * sends rather than what would be tidier.
 */
export const optionalCivilDate = () =>
  z.preprocess((v) => (v === '' ? undefined : v), civilDateSchema.optional());

/** As above, but an empty value means "clear this field" rather than "unset". */
export const nullableCivilDate = () =>
  z.preprocess((v) => (v === '' ? null : v), civilDateSchema.nullable().optional());

export const optionalTimeOfDay = () =>
  z.preprocess((v) => (v === '' ? undefined : v), timeOfDaySchema.optional());

export const nullableTimeOfDay = () =>
  z.preprocess((v) => (v === '' ? null : v), timeOfDaySchema.nullable().optional());

export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Expected a 3-letter ISO 4217 currency code');

/**
 * Validated against the platform's own timezone database rather than a
 * hard-coded list, so it stays correct as the IANA database is updated.
 */
export const timezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Expected a valid IANA timezone, e.g. Asia/Karachi' },
);

export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'Expected a 2-letter country code');

/** Money on the wire is always integer minor units plus a currency (docs/04). */
export const amountMinorSchema = z
  .number()
  .int('Amounts must be whole minor units — never a decimal')
  .nonnegative();

/** Trims, and turns an empty string into undefined so blank form fields do not store "". */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

export const requiredText = (max: number, label = 'This field') =>
  z.string().trim().min(1, `${label} is required`).max(max);

/**
 * A boolean as it arrives over the wire.
 *
 * `z.coerce.boolean()` is `Boolean(value)`, so the string "false" — which is
 * exactly what a query string or an env file contains — parses as **true**.
 * That silently inverts every flag it touches, so it is never used in this
 * codebase; this is the only boolean parser.
 */
const BOOLEAN_WORDS: Record<string, boolean> = {
  true: true, false: false,
  '1': true, '0': false,
  yes: true, no: false,
  on: true, off: false,
};

export const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value, ctx) => {
    if (typeof value === 'boolean') return value;
    const parsed = BOOLEAN_WORDS[value.trim().toLowerCase()];
    if (parsed === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected true or false',
      });
      return z.NEVER;
    }
    return parsed;
  });

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

export const sortOrderSchema = z.enum(['asc', 'desc']).default('asc');

/** Recurrence as it crosses the wire; mirrors `RecurrenceRule` (docs/08). */
export const recurrenceRuleSchema = z
  .object({
    freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).max(365).default(1),
    byWeekday: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    byMonthday: z.array(z.number().int().min(-1).max(31).refine((d) => d !== 0)).max(31).optional(),
    byMonth: z.array(z.number().int().min(1).max(12)).max(12).optional(),
    until: civilDateSchema.optional(),
    count: z.number().int().min(1).max(1000).optional(),
  })
  .refine((r) => !(r.until && r.count), {
    message: 'A recurrence may end on a date or after a count, not both',
    path: ['until'],
  })
  .refine((r) => r.freq === 'weekly' || !r.byWeekday?.length, {
    message: 'byWeekday applies to weekly recurrences only',
    path: ['byWeekday'],
  })
  .refine((r) => r.freq !== 'daily' || !r.byMonthday?.length, {
    message: 'byMonthday does not apply to daily recurrences',
    path: ['byMonthday'],
  })
  .refine((r) => r.freq === 'yearly' || !r.byMonth?.length, {
    message: 'byMonth applies to yearly recurrences only',
    path: ['byMonth'],
  });
export type RecurrenceRuleInput = z.infer<typeof recurrenceRuleSchema>;
