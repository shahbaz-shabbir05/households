import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  addLowStockSchema,
  addShoppingItemSchema,
  completeTripSchema,
  createShoppingListSchema,
  listShoppingListsQuerySchema,
  updateShoppingItemSchema,
  updateShoppingListSchema,
} from '@hms/shared';
import type { Container } from '../../container.js';
import { context, createGuards } from '../../http/guards.js';
import { parseBody, parseParams, parseQuery } from '../../http/validate.js';

const listParams = z.object({ listId: z.string().uuid() });
const itemParams = listParams.extend({ itemId: z.string().uuid() });

export async function registerShoppingRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const { requireAuth, requireHousehold } = createGuards(container);
  const household = { preHandler: [requireAuth, requireHousehold] };

  app.get('/households/:householdId/shopping-lists', {
    ...household,
    handler: async (request, reply) =>
      reply.send(
        await container.shopping.listLists(context(request), parseQuery(request, listShoppingListsQuerySchema)),
      ),
  });

  app.post('/households/:householdId/shopping-lists', {
    ...household,
    handler: async (request, reply) => {
      const input = parseBody(request, createShoppingListSchema);
      return reply.status(201).send({ data: await container.shopping.createList(context(request), input) });
    },
  });

  app.get('/households/:householdId/shopping-lists/:listId', {
    ...household,
    handler: async (request, reply) => {
      const { listId } = parseParams(request, listParams);
      return reply.send({ data: await container.shopping.getList(context(request), listId) });
    },
  });

  app.patch('/households/:householdId/shopping-lists/:listId', {
    ...household,
    handler: async (request, reply) => {
      const { listId } = parseParams(request, listParams);
      const input = parseBody(request, updateShoppingListSchema);
      return reply.send({ data: await container.shopping.updateList(context(request), listId, input) });
    },
  });

  app.delete('/households/:householdId/shopping-lists/:listId', {
    ...household,
    handler: async (request, reply) => {
      const { listId } = parseParams(request, listParams);
      await container.shopping.removeList(context(request), listId);
      return reply.status(204).send();
    },
  });

  app.post('/households/:householdId/shopping-lists/:listId/items', {
    ...household,
    handler: async (request, reply) => {
      const { listId } = parseParams(request, listParams);
      const input = parseBody(request, addShoppingItemSchema);
      return reply.status(201).send({ data: await container.shopping.addItem(context(request), listId, input) });
    },
  });

  app.patch('/households/:householdId/shopping-lists/:listId/items/:itemId', {
    ...household,
    handler: async (request, reply) => {
      const { listId, itemId } = parseParams(request, itemParams);
      const input = parseBody(request, updateShoppingItemSchema);
      return reply.send({ data: await container.shopping.updateItem(context(request), listId, itemId, input) });
    },
  });

  app.delete('/households/:householdId/shopping-lists/:listId/items/:itemId', {
    ...household,
    handler: async (request, reply) => {
      const { listId, itemId } = parseParams(request, itemParams);
      await container.shopping.removeItem(context(request), listId, itemId);
      return reply.status(204).send();
    },
  });

  /** One tap: everything running low goes on the list. */
  app.post('/households/:householdId/shopping-lists/:listId/add-low-stock', {
    ...household,
    handler: async (request, reply) => {
      const { listId } = parseParams(request, listParams);
      const input = parseBody(request, addLowStockSchema);
      return reply.send({ data: await container.shopping.addLowStock(context(request), listId, input) });
    },
  });

  /**
   * The trip workflow: purchased → inventory restocked → expense recorded →
   * list closed, atomically. See the shopping service header for why this is
   * one endpoint and not three (docs/06).
   */
  app.post('/households/:householdId/shopping-lists/:listId/complete', {
    ...household,
    handler: async (request, reply) => {
      const { listId } = parseParams(request, listParams);
      const input = parseBody(request, completeTripSchema);
      return reply.send({ data: await container.shopping.completeTrip(context(request), listId, input) });
    },
  });
}
