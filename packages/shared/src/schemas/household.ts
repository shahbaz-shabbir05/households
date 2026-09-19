import { z } from 'zod';
import {
  countryCodeSchema,
  currencySchema,
  requiredText,
  timeOfDaySchema,
  timezoneSchema,
} from './common.js';

export const createHouseholdSchema = z.object({
  name: requiredText(120, 'Household name'),
  currency: currencySchema.default('PKR'),
  timezone: timezoneSchema.default('Asia/Karachi'),
  countryCode: countryCodeSchema.default('PK'),
  locale: z.string().max(20).default('en-PK'),
});
export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;

export const updateHouseholdSchema = z.object({
  name: requiredText(120, 'Household name').optional(),
  currency: currencySchema.optional(),
  timezone: timezoneSchema.optional(),
  countryCode: countryCodeSchema.optional(),
  locale: z.string().max(20).optional(),
  /**
   * Non-urgent notifications generated inside this window are deferred to the
   * next window start, so the app does not wake a family at 3am (docs/09).
   */
  quietHoursStart: timeOfDaySchema.nullable().optional(),
  quietHoursEnd: timeOfDaySchema.nullable().optional(),
  weekStartsOn: z.number().int().min(0).max(1).optional(),
});
export type UpdateHouseholdInput = z.infer<typeof updateHouseholdSchema>;
