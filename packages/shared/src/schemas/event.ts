import { z } from 'zod';
import { EVENT_TYPES } from '../enums.js';
import {
  civilDateSchema,
  optionalText,
  paginationSchema,
  recurrenceRuleSchema,
  requiredText,
  timeOfDaySchema,
  uuidSchema,
} from './common.js';

export const eventTypeSchema = z.enum(EVENT_TYPES);

const eventFields = {
  title: requiredText(200, 'Event title'),
  description: optionalText(4000),
  eventType: eventTypeSchema.default('other'),
  startDate: civilDateSchema,
  startTime: timeOfDaySchema.nullable().optional(),
  endDate: civilDateSchema.nullable().optional(),
  endTime: timeOfDaySchema.nullable().optional(),
  location: optionalText(200),
  participantMemberIds: z.array(uuidSchema).max(50).default([]),
  recurrence: recurrenceRuleSchema.optional(),
  /** Minutes before the event to raise a reminder; null means none. */
  remindMinutesBefore: z.number().int().min(0).max(60 * 24 * 30).nullable().optional(),
};

export const createEventSchema = z
  .object(eventFields)
  .refine((e) => !e.endDate || e.endDate >= e.startDate, {
    message: 'An event cannot end before it starts',
    path: ['endDate'],
  })
  .refine((e) => !e.endTime || e.startTime, {
    message: 'An end time needs a start time',
    path: ['endTime'],
  });
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z.object({
  ...eventFields,
  title: requiredText(200, 'Event title').optional(),
  startDate: civilDateSchema.optional(),
  participantMemberIds: z.array(uuidSchema).max(50).optional(),
  recurrence: z.undefined().optional(),
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const listEventsQuerySchema = paginationSchema.extend({
  from: civilDateSchema.optional(),
  to: civilDateSchema.optional(),
  eventType: eventTypeSchema.optional(),
  participantMemberId: uuidSchema.optional(),
  search: optionalText(200),
});
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
