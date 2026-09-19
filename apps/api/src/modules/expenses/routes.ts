import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createExpenseSchema,
  expenseSummaryQuerySchema,
  listExpensesQuerySchema,
  updateExpenseSchema,
} from '@hms/shared';
import type { Container } from '../../container.js';
import { context, createGuards } from '../../http/guards.js';
import { parseBody, parseParams, parseQuery } from '../../http/validate.js';

const expenseParams = z.object({ expenseId: z.string().uuid() });

export async function registerExpenseRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const { requireAuth, requireHousehold } = createGuards(container);
  const household = { preHandler: [requireAuth, requireHousehold] };

  app.get('/households/:householdId/expenses', {
    ...household,
    handler: async (request, reply) =>
      reply.send(await container.expenses.list(context(request), parseQuery(request, listExpensesQuerySchema))),
  });

  /** The "what did we spend this month" answer, with last month's for contrast. */
  app.get('/households/:householdId/expenses/summary', {
    ...household,
    handler: async (request, reply) => {
      const { month } = parseQuery(request, expenseSummaryQuerySchema);
      return reply.send({ data: await container.expenses.monthlySummary(context(request), month) });
    },
  });

  app.post('/households/:householdId/expenses', {
    ...household,
    handler: async (request, reply) => {
      const input = parseBody(request, createExpenseSchema);
      return reply.status(201).send({ data: await container.expenses.create(context(request), input) });
    },
  });

  app.get('/households/:householdId/expenses/:expenseId', {
    ...household,
    handler: async (request, reply) => {
      const { expenseId } = parseParams(request, expenseParams);
      return reply.send({ data: await container.expenses.get(context(request), expenseId) });
    },
  });

  app.patch('/households/:householdId/expenses/:expenseId', {
    ...household,
    handler: async (request, reply) => {
      const { expenseId } = parseParams(request, expenseParams);
      const input = parseBody(request, updateExpenseSchema);
      return reply.send({ data: await container.expenses.update(context(request), expenseId, input) });
    },
  });

  app.delete('/households/:householdId/expenses/:expenseId', {
    ...household,
    handler: async (request, reply) => {
      const { expenseId } = parseParams(request, expenseParams);
      await container.expenses.remove(context(request), expenseId);
      return reply.status(204).send();
    },
  });
}
