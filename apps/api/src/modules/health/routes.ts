import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createAppointmentSchema,
  createDoctorSchema,
  createMedicineSchema,
  listAppointmentsQuerySchema,
  listDosesQuerySchema,
  listMedicinesQuerySchema,
  recordDoseSchema,
  refillMedicineSchema,
  updateAppointmentSchema,
  updateDoctorSchema,
  updateMedicineSchema,
} from '@hms/shared';
import type { Container } from '../../container.js';
import { context, createGuards } from '../../http/guards.js';
import { parseBody, parseParams, parseQuery } from '../../http/validate.js';

const doctorParams = z.object({ doctorId: z.string().uuid() });
const appointmentParams = z.object({ appointmentId: z.string().uuid() });
const medicineParams = z.object({ medicineId: z.string().uuid() });
const doseParams = z.object({ doseId: z.string().uuid() });

export async function registerHealthRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const { requireAuth, requireHousehold } = createGuards(container);
  const household = { preHandler: [requireAuth, requireHousehold] };

  /* --------------------------------------------------------------- doctors */

  app.get('/households/:householdId/doctors', {
    ...household,
    handler: async (request, reply) =>
      reply.send({ data: await container.doctors.list(context(request)) }),
  });

  app.post('/households/:householdId/doctors', {
    ...household,
    handler: async (request, reply) => {
      const input = parseBody(request, createDoctorSchema);
      return reply.status(201).send({ data: await container.doctors.create(context(request), input) });
    },
  });

  app.patch('/households/:householdId/doctors/:doctorId', {
    ...household,
    handler: async (request, reply) => {
      const { doctorId } = parseParams(request, doctorParams);
      const input = parseBody(request, updateDoctorSchema);
      return reply.send({ data: await container.doctors.update(context(request), doctorId, input) });
    },
  });

  app.delete('/households/:householdId/doctors/:doctorId', {
    ...household,
    handler: async (request, reply) => {
      const { doctorId } = parseParams(request, doctorParams);
      await container.doctors.remove(context(request), doctorId);
      return reply.status(204).send();
    },
  });

  /* ---------------------------------------------------------- appointments */

  app.get('/households/:householdId/appointments', {
    ...household,
    handler: async (request, reply) =>
      reply.send(
        await container.appointments.list(context(request), parseQuery(request, listAppointmentsQuerySchema)),
      ),
  });

  app.post('/households/:householdId/appointments', {
    ...household,
    handler: async (request, reply) => {
      const input = parseBody(request, createAppointmentSchema);
      return reply
        .status(201)
        .send({ data: await container.appointments.create(context(request), input) });
    },
  });

  app.get('/households/:householdId/appointments/:appointmentId', {
    ...household,
    handler: async (request, reply) => {
      const { appointmentId } = parseParams(request, appointmentParams);
      return reply.send({ data: await container.appointments.get(context(request), appointmentId) });
    },
  });

  app.patch('/households/:householdId/appointments/:appointmentId', {
    ...household,
    handler: async (request, reply) => {
      const { appointmentId } = parseParams(request, appointmentParams);
      const input = parseBody(request, updateAppointmentSchema);
      return reply.send({
        data: await container.appointments.update(context(request), appointmentId, input),
      });
    },
  });

  app.delete('/households/:householdId/appointments/:appointmentId', {
    ...household,
    handler: async (request, reply) => {
      const { appointmentId } = parseParams(request, appointmentParams);
      await container.appointments.remove(context(request), appointmentId);
      return reply.status(204).send();
    },
  });

  /* ------------------------------------------------------------- medicines */

  app.get('/households/:householdId/medicines', {
    ...household,
    handler: async (request, reply) =>
      reply.send(
        await container.medicines.list(context(request), parseQuery(request, listMedicinesQuerySchema)),
      ),
  });

  app.post('/households/:householdId/medicines', {
    ...household,
    handler: async (request, reply) => {
      const input = parseBody(request, createMedicineSchema);
      return reply.status(201).send({ data: await container.medicines.create(context(request), input) });
    },
  });

  app.get('/households/:householdId/medicines/:medicineId', {
    ...household,
    handler: async (request, reply) => {
      const { medicineId } = parseParams(request, medicineParams);
      return reply.send({ data: await container.medicines.get(context(request), medicineId) });
    },
  });

  app.patch('/households/:householdId/medicines/:medicineId', {
    ...household,
    handler: async (request, reply) => {
      const { medicineId } = parseParams(request, medicineParams);
      const input = parseBody(request, updateMedicineSchema);
      return reply.send({ data: await container.medicines.update(context(request), medicineId, input) });
    },
  });

  /** Records that more was bought. The count is the household's own. */
  app.post('/households/:householdId/medicines/:medicineId/refill', {
    ...household,
    handler: async (request, reply) => {
      const { medicineId } = parseParams(request, medicineParams);
      const input = parseBody(request, refillMedicineSchema);
      return reply.send({ data: await container.medicines.refill(context(request), medicineId, input) });
    },
  });

  app.delete('/households/:householdId/medicines/:medicineId', {
    ...household,
    handler: async (request, reply) => {
      const { medicineId } = parseParams(request, medicineParams);
      await container.medicines.remove(context(request), medicineId);
      return reply.status(204).send();
    },
  });

  /* ----------------------------------------------------------------- doses */

  app.get('/households/:householdId/doses', {
    ...household,
    handler: async (request, reply) =>
      reply.send({
        data: await container.medicines.listDoses(context(request), parseQuery(request, listDosesQuerySchema)),
      }),
  });

  /**
   * Records what happened with one dose — taken or skipped, nothing else.
   * There is deliberately no endpoint that changes a dose amount.
   */
  app.post('/households/:householdId/doses/:doseId/record', {
    ...household,
    handler: async (request, reply) => {
      const { doseId } = parseParams(request, doseParams);
      const input = parseBody(request, recordDoseSchema);
      return reply.send({ data: await container.medicines.recordDose(context(request), doseId, input) });
    },
  });
}
