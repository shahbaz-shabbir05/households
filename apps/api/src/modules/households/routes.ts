import type { FastifyInstance } from 'fastify';
import { createHouseholdSchema, updateHouseholdSchema } from '@hms/shared';
import type { Container } from '../../container.js';
import { context, createGuards, userContext } from '../../http/guards.js';
import { parseBody } from '../../http/validate.js';

export async function registerHouseholdRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const { requireAuth, requireHousehold } = createGuards(container);

  app.get('/households', {
    preHandler: requireAuth,
    handler: async (request, reply) => {
      const ctx = userContext(request);
      return reply.send({ data: await container.households.listForUser(ctx.user.id) });
    },
  });

  app.post('/households', {
    preHandler: requireAuth,
    handler: async (request, reply) => {
      const ctx = userContext(request);
      const input = parseBody(request, createHouseholdSchema);
      const household = await container.households.create(ctx, input);
      return reply.status(201).send({ data: household });
    },
  });

  app.get('/households/:householdId', {
    preHandler: [requireAuth, requireHousehold],
    handler: async (request, reply) => {
      return reply.send({ data: await container.households.get(context(request)) });
    },
  });

  app.patch('/households/:householdId', {
    preHandler: [requireAuth, requireHousehold],
    handler: async (request, reply) => {
      const input = parseBody(request, updateHouseholdSchema);
      return reply.send({ data: await container.households.update(context(request), input) });
    },
  });
}
