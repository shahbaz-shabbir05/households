import { z } from 'zod';
import { ENTITY_TYPES, PRIORITIES, REMINDER_STATUSES } from '../enums.js';
import {
  civilDateSchema,
  optionalText,
  paginationSchema,
  recurrenceRuleSchema,
  requiredText,
  timeOfDaySchema,
  uuidSchema,
} from './common.js';

export const reminderStatusSchema = z.enum(REMINDER_STATUSES);

export const createReminderSchema = z.object({
  title: requiredText(200, 'Reminder'),
  body: optionalText(2000),
  /** Date and time as the user typed them; converted to an instant in household time. */
  remindOnDate: civilDateSchema,
  remindAtTime: timeOfDaySchema.default('09:00'),
  priority: z.enum(PRIORITIES).default('normal'),
  assigneeMemberId: uuidSchema.nullable().optional(),
  entityType: z.enum(ENTITY_TYPES).nullable().optional(),
  entityId: uuidSchema.nullable().optional(),
  recurrence: recurrenceRuleSchema.optional(),
});
export type CreateReminderInput = z.infer<typeof createReminderSchema>;

export const updateReminderSchema = z.object({
  title: requiredText(200, 'Reminder').optional(),
  body: optionalText(2000),
  remindOnDate: civilDateSchema.optional(),
  remindAtTime: timeOfDaySchema.optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeMemberId: uuidSchema.nullable().optional(),
  status: z.enum(['pending', 'dismissed']).optional(),
});
export type UpdateReminderInput = z.infer<typeof updateReminderSchema>;

export const snoozeReminderSchema = z.object({
  minutes: z.number().int().min(1).max(60 * 24 * 30).default(60),
});
export type SnoozeReminderInput = z.infer<typeof snoozeReminderSchema>;

export const listRemindersQuerySchema = paginationSchema.extend({
  status: reminderStatusSchema.optional(),
  assigneeMemberId: uuidSchema.optional(),
  from: civilDateSchema.optional(),
  to: civilDateSchema.optional(),
});
export type ListRemindersQuery = z.infer<typeof listRemindersQuerySchema>;
