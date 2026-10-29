import { z } from 'zod';
import {
  booleanish,
  civilDateSchema,
  optionalCivilDate,
  optionalText,
  paginationSchema,
  recurrenceRuleSchema,
  requiredText,
  timeOfDaySchema,
  uuidSchema,
} from './common.js';

export const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'rescheduled'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);

export const DOSE_STATUSES = ['due', 'taken', 'skipped', 'missed'] as const;
export type DoseStatus = (typeof DOSE_STATUSES)[number];
export const doseStatusSchema = z.enum(DOSE_STATUSES);

/* ------------------------------------------------------------------ doctors */

export const createDoctorSchema = z.object({
  name: requiredText(120, "Doctor's name"),
  specialty: optionalText(80),
  clinic: optionalText(120),
  phone: optionalText(40),
  address: optionalText(300),
  notes: optionalText(1000),
});
export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;

export const updateDoctorSchema = createDoctorSchema.partial();
export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;

/* ------------------------------------------------------------- appointments */

export const createAppointmentSchema = z
  .object({
    memberId: uuidSchema,
    /** Matched to an existing doctor by name, or created on first use. */
    doctorName: optionalText(120),
    doctorId: uuidSchema.optional(),
    scheduledOn: civilDateSchema,
    scheduledAtTime: timeOfDaySchema.optional(),
    location: optionalText(200),
    reason: optionalText(500),
    remindDaysBefore: z.coerce.number().int().min(0).max(30).default(1),
    notes: optionalText(1000),
    recurrence: recurrenceRuleSchema.optional(),
  });
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export const updateAppointmentSchema = z.object({
  doctorName: optionalText(120),
  scheduledOn: civilDateSchema.optional(),
  scheduledAtTime: timeOfDaySchema.nullable().optional(),
  location: optionalText(200),
  reason: optionalText(500),
  status: appointmentStatusSchema.optional(),
  /**
   * What the doctor said, in the household's own words. Recorded verbatim and
   * never interpreted by the system.
   */
  outcomeNotes: optionalText(4000),
  followUpOn: optionalCivilDate(),
  remindDaysBefore: z.coerce.number().int().min(0).max(30).optional(),
  notes: optionalText(1000),
});
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;

export const listAppointmentsQuerySchema = paginationSchema.extend({
  memberId: uuidSchema.optional(),
  status: appointmentStatusSchema.optional(),
  upcoming: booleanish.optional(),
  from: optionalCivilDate(),
  to: optionalCivilDate(),
});
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

/* ---------------------------------------------------------------- medicines */

/**
 * Note what is *not* here: no dose amount, no unit, no parsed frequency.
 *
 * `doseText` and `frequencyText` are free text copied off the prescription and
 * shown back unaltered. The system reminds and records; it never computes a
 * dose, and a schema that captured amounts would invite it to (docs/01 §9).
 */
export const createMedicineSchema = z
  .object({
    memberId: uuidSchema,
    name: requiredText(160, 'Medicine name'),
    doseText: requiredText(200, 'Dose'),
    frequencyText: optionalText(200),
    instructions: optionalText(1000),

    /** The times the household wants reminding — entered, never inferred. */
    reminderTimes: z.array(timeOfDaySchema).max(12).default([]),

    startDate: civilDateSchema,
    endDate: optionalCivilDate(),

    quantityRemaining: z.coerce.number().min(0).max(100000).nullable().optional(),
    refillThreshold: z.coerce.number().min(0).max(100000).nullable().optional(),
    prescribedByDoctorName: optionalText(120),
    notes: optionalText(1000),
  })
  .refine((m) => !m.endDate || m.endDate >= m.startDate, {
    message: 'A course cannot end before it starts',
    path: ['endDate'],
  });
export type CreateMedicineInput = z.infer<typeof createMedicineSchema>;

export const updateMedicineSchema = z.object({
  name: requiredText(160, 'Medicine name').optional(),
  doseText: requiredText(200, 'Dose').optional(),
  frequencyText: optionalText(200),
  instructions: optionalText(1000),
  reminderTimes: z.array(timeOfDaySchema).max(12).optional(),
  endDate: optionalCivilDate(),
  quantityRemaining: z.coerce.number().min(0).max(100000).nullable().optional(),
  refillThreshold: z.coerce.number().min(0).max(100000).nullable().optional(),
  notes: optionalText(1000),
});
export type UpdateMedicineInput = z.infer<typeof updateMedicineSchema>;

export const listMedicinesQuerySchema = paginationSchema.extend({
  memberId: uuidSchema.optional(),
  /** Only courses that are running today. */
  active: booleanish.optional(),
  needsRefill: booleanish.optional(),
});
export type ListMedicinesQuery = z.infer<typeof listMedicinesQuerySchema>;

/** Recording what actually happened. Never "adjust the dose" — only this. */
export const recordDoseSchema = z.object({
  status: z.enum(['taken', 'skipped']),
  /** Reduce the remaining count. Off when the household is not tracking stock. */
  decrementStock: booleanish.default(true),
});
export type RecordDoseInput = z.infer<typeof recordDoseSchema>;

export const listDosesQuerySchema = z.object({
  memberId: uuidSchema.optional(),
  medicineId: uuidSchema.optional(),
  from: optionalCivilDate(),
  to: optionalCivilDate(),
  status: doseStatusSchema.optional(),
});
export type ListDosesQuery = z.infer<typeof listDosesQuerySchema>;

export const refillMedicineSchema = z.object({
  /** How many were added. Recorded, never inferred from the dose text. */
  quantityAdded: z.coerce.number().positive().max(100000),
});
export type RefillMedicineInput = z.infer<typeof refillMedicineSchema>;
