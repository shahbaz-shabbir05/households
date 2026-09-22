import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createBillSchema, listBillsQuerySchema, payBillSchema, updateBillSchema } from '@hms/shared';
import type { Container } from '../../container.js';
import { context, createGuards } from '../../http/guards.js';
import { parseBody, parseParams, parseQuery } from '../../http/validate.js';

const billParams = z.object({ billId: z.string().uuid() });

export async function registerBillRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const { requireAuth, requireHousehold } = createGuards(container);
  const household = { preHandler: [requireAuth, requireHousehold] };

  app.get('/households/:householdId/bills', {
    ...household,
    handler: async (request, reply) =>
      reply.send(await container.bills.list(context(request), parseQuery(request, listBillsQuerySchema))),
  });

  app.post('/households/:householdId/bills', {
    ...household,
    handler: async (request, reply) => {
      const input = parseBody(request, createBillSchema);
      return reply.status(201).send({ data: await container.bills.create(context(request), input) });
    },
  });

  app.get('/households/:householdId/bills/:billId', {
    ...household,
    handler: async (request, reply) => {
      const { billId } = parseParams(request, billParams);
      return reply.send({ data: await container.bills.get(context(request), billId) });
    },
  });

  app.patch('/households/:householdId/bills/:billId', {
    ...household,
    handler: async (request, reply) => {
      const { billId } = parseParams(request, billParams);
      const input = parseBody(request, updateBillSchema);
      return reply.send({ data: await container.bills.update(context(request), billId, input) });
    },
  });

  /**
   * Payment → expense, atomically. The same composition as completing a
   * shopping trip: doing it as two calls would guarantee a paid bill with no
   * ledger entry the first time a connection drops (docs/06).
   */
  app.post('/households/:householdId/bills/:billId/pay', {
    ...household,
    handler: async (request, reply) => {
      const { billId } = parseParams(request, billParams);
      const input = parseBody(request, payBillSchema);
      return reply.send({ data: await container.bills.pay(context(request), billId, input) });
    },
  });

  app.post('/households/:householdId/bills/:billId/unpay', {
    ...household,
    handler: async (request, reply) => {
      const { billId } = parseParams(request, billParams);
      return reply.send({ data: await container.bills.unpay(context(request), billId) });
    },
  });

  app.delete('/households/:householdId/bills/:billId', {
    ...household,
    handler: async (request, reply) => {
      const { billId } = parseParams(request, billParams);
      await container.bills.remove(context(request), billId);
      return reply.status(204).send();
    },
  });
}
