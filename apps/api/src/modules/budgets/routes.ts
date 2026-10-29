import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { budgetStatusQuerySchema, createBudgetSchema, updateBudgetSchema } from '@hms/shared';
import type { Container } from '../../container.js';
import { context, createGuards } from '../../http/guards.js';
import { parseBody, parseParams, parseQuery } from '../../http/validate.js';

const budgetParams = z.object({ budgetId: z.string().uuid() });

export async function registerBudgetRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const { requireAuth, requireHousehold } = createGuards(container);
  const household = { preHandler: [requireAuth, requireHousehold] };

  app.get('/households/:householdId/budgets', {
    ...household,
    handler: async (request, reply) =>
      reply.send({ data: await container.budgets.list(context(request)) }),
  });

  /** How each budget is doing this month — the only view anyone actually opens. */
  app.get('/households/:householdId/budgets/status', {
    ...household,
    handler: async (request, reply) => {
      const { month } = parseQuery(request, budgetStatusQuerySchema);
      return reply.send({ data: await container.budgets.status(context(request), month) });
    },
  });

  app.post('/households/:householdId/budgets', {
    ...household,
    handler: async (request, reply) => {
      const input = parseBody(request, createBudgetSchema);
      return reply.status(201).send({ data: await container.budgets.create(context(request), input) });
    },
  });

  app.patch('/households/:householdId/budgets/:budgetId', {
    ...household,
    handler: async (request, reply) => {
      const { budgetId } = parseParams(request, budgetParams);
      const input = parseBody(request, updateBudgetSchema);
      return reply.send({ data: await container.budgets.update(context(request), budgetId, input) });
    },
  });

  app.delete('/households/:householdId/budgets/:budgetId', {
    ...household,
    handler: async (request, reply) => {
      const { budgetId } = parseParams(request, budgetParams);
      await container.budgets.remove(context(request), budgetId);
      return reply.status(204).send();
    },
  });
}
