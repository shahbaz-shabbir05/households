import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  adjustInventorySchema,
  createInventoryItemSchema,
  listInventoryQuerySchema,
  updateInventoryItemSchema,
} from '@hms/shared';
import type { Container } from '../../container.js';
import { context, createGuards } from '../../http/guards.js';
import { parseBody, parseParams, parseQuery } from '../../http/validate.js';

const itemParams = z.object({ itemId: z.string().uuid() });

export async function registerInventoryRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const { requireAuth, requireHousehold } = createGuards(container);
  const household = { preHandler: [requireAuth, requireHousehold] };

  app.get('/households/:householdId/inventory', {
    ...household,
    handler: async (request, reply) =>
      reply.send(await container.inventory.list(context(request), parseQuery(request, listInventoryQuerySchema))),
  });

  app.post('/households/:householdId/inventory', {
    ...household,
    handler: async (request, reply) => {
      const input = parseBody(request, createInventoryItemSchema);
      return reply.status(201).send({ data: await container.inventory.create(context(request), input) });
    },
  });

  app.get('/households/:householdId/inventory/:itemId', {
    ...household,
    handler: async (request, reply) => {
      const { itemId } = parseParams(request, itemParams);
      return reply.send({ data: await container.inventory.get(context(request), itemId) });
    },
  });

  app.patch('/households/:householdId/inventory/:itemId', {
    ...household,
    handler: async (request, reply) => {
      const { itemId } = parseParams(request, itemParams);
      const input = parseBody(request, updateInventoryItemSchema);
      return reply.send({ data: await container.inventory.update(context(request), itemId, input) });
    },
  });

  /**
   * Stock changes are their own endpoint: "we used two" and "we now have two"
   * are different statements, and a shared PATCH would blur them.
   */
  app.post('/households/:householdId/inventory/:itemId/adjust', {
    ...household,
    handler: async (request, reply) => {
      const { itemId } = parseParams(request, itemParams);
      const input = parseBody(request, adjustInventorySchema);
      return reply.send({ data: await container.inventory.adjust(context(request), itemId, input) });
    },
  });

  app.delete('/households/:householdId/inventory/:itemId', {
    ...household,
    handler: async (request, reply) => {
      const { itemId } = parseParams(request, itemParams);
      await container.inventory.remove(context(request), itemId);
      return reply.status(204).send();
    },
  });
}
