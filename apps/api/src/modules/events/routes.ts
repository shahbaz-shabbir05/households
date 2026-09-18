import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createEventSchema, listEventsQuerySchema, updateEventSchema } from '@hms/shared';
import type { Container } from '../../container.js';
import { context, createGuards } from '../../http/guards.js';
import { parseBody, parseParams, parseQuery } from '../../http/validate.js';

const eventParams = z.object({ eventId: z.string().uuid() });

export async function registerEventRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const { requireAuth, requireHousehold } = createGuards(container);
  const household = { preHandler: [requireAuth, requireHousehold] };

  app.get('/households/:householdId/events', {
    ...household,
    handler: async (request, reply) =>
      reply.send(await container.events.list(context(request), parseQuery(request, listEventsQuerySchema))),
  });

  app.post('/households/:householdId/events', {
    ...household,
    handler: async (request, reply) => {
      const input = parseBody(request, createEventSchema);
      return reply.status(201).send({ data: await container.events.create(context(request), input) });
    },
  });

  app.get('/households/:householdId/events/:eventId', {
    ...household,
    handler: async (request, reply) => {
      const { eventId } = parseParams(request, eventParams);
      return reply.send({ data: await container.events.get(context(request), eventId) });
    },
  });

  app.patch('/households/:householdId/events/:eventId', {
    ...household,
    handler: async (request, reply) => {
      const { eventId } = parseParams(request, eventParams);
      const input = parseBody(request, updateEventSchema);
      return reply.send({ data: await container.events.update(context(request), eventId, input) });
    },
  });

  app.delete('/households/:householdId/events/:eventId', {
    ...household,
    handler: async (request, reply) => {
      const { eventId } = parseParams(request, eventParams);
      await container.events.remove(context(request), eventId);
      return reply.status(204).send();
    },
  });
}
