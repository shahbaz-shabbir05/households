import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createReminderSchema,
  listRemindersQuerySchema,
  snoozeReminderSchema,
  updateReminderSchema,
} from '@hms/shared';
import type { Container } from '../../container.js';
import { context, createGuards } from '../../http/guards.js';
import { parseBody, parseParams, parseQuery } from '../../http/validate.js';

const reminderParams = z.object({ reminderId: z.string().uuid() });

export async function registerReminderRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const { requireAuth, requireHousehold } = createGuards(container);
  const household = { preHandler: [requireAuth, requireHousehold] };

  app.get('/households/:householdId/reminders', {
    ...household,
    handler: async (request, reply) =>
      reply.send(await container.reminders.list(context(request), parseQuery(request, listRemindersQuerySchema))),
  });

  app.post('/households/:householdId/reminders', {
    ...household,
    handler: async (request, reply) => {
      const input = parseBody(request, createReminderSchema);
      return reply.status(201).send({ data: await container.reminders.create(context(request), input) });
    },
  });

  app.patch('/households/:householdId/reminders/:reminderId', {
    ...household,
    handler: async (request, reply) => {
      const { reminderId } = parseParams(request, reminderParams);
      const input = parseBody(request, updateReminderSchema);
      return reply.send({ data: await container.reminders.update(context(request), reminderId, input) });
    },
  });

  app.post('/households/:householdId/reminders/:reminderId/snooze', {
    ...household,
    handler: async (request, reply) => {
      const { reminderId } = parseParams(request, reminderParams);
      const { minutes } = parseBody(request, snoozeReminderSchema);
      return reply.send({ data: await container.reminders.snooze(context(request), reminderId, minutes) });
    },
  });

  app.post('/households/:householdId/reminders/:reminderId/dismiss', {
    ...household,
    handler: async (request, reply) => {
      const { reminderId } = parseParams(request, reminderParams);
      await container.reminders.dismiss(context(request), reminderId);
      return reply.send({ data: { ok: true } });
    },
  });

  app.delete('/households/:householdId/reminders/:reminderId', {
    ...household,
    handler: async (request, reply) => {
      const { reminderId } = parseParams(request, reminderParams);
      await container.reminders.remove(context(request), reminderId);
      return reply.status(204).send();
    },
  });
}
