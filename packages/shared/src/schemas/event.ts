import { z } from 'zod';
import { EVENT_TYPES } from '../enums.js';
import {
  civilDateSchema,
  nullableCivilDate,
  nullableTimeOfDay,
  optionalText,
  paginationSchema,
  recurrenceRuleSchema,
  requiredText,
  uuidSchema,
} from './common.js';

export const eventTypeSchema = z.enum(EVENT_TYPES);

const eventFields = {
  title: requiredText(200, 'Event title'),
  description: optionalText(4000),
  eventType: eventTypeSchema.default('other'),
  startDate: civilDateSchema,
  startTime: nullableTimeOfDay(),
  endDate: nullableCivilDate(),
  endTime: nullableTimeOfDay(),
  location: optionalText(200),
  participantMemberIds: z.array(uuidSchema).max(50).default([]),
  recurrence: recurrenceRuleSchema.optional(),
  // NOTE: there is deliberately no `remindMinutesBefore` here. An earlier
  // version accepted one and never created a reminder — the API returned 201
  // and nothing ever fired. A contract must not promise behaviour the system
  // does not have. Event reminders are a V1 item (docs/15); until then a
  // standalone reminder linked to the event does the same job honestly.
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

/**
 * Every defaulted field from `eventFields` has to be re-declared as optional
 * here. `eventType` carries `.default('other')`, so without this a PATCH that
 * only renames an event would silently convert a birthday into an "other" and
 * drop it out of the birthday views.
 */
export const updateEventSchema = z.object({
  ...eventFields,
  title: requiredText(200, 'Event title').optional(),
  eventType: eventTypeSchema.optional(),
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
