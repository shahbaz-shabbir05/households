import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  completeTaskSchema,
  createTaskSchema,
  listTasksQuerySchema,
  seriesScopeSchema,
  updateTaskSchema,
} from '@hms/shared';
import type { Container } from '../../container.js';
import { context, createGuards } from '../../http/guards.js';
import { parseBody, parseParams, parseQuery } from '../../http/validate.js';

const taskParams = z.object({ taskId: z.string().uuid() });
const deleteQuery = z.object({ scope: seriesScopeSchema });

export async function registerTaskRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const { requireAuth, requireHousehold } = createGuards(container);
  const household = { preHandler: [requireAuth, requireHousehold] };

  app.get('/households/:householdId/tasks', {
    ...household,
    handler: async (request, reply) => {
      const query = parseQuery(request, listTasksQuerySchema);
      return reply.send(await container.tasks.list(context(request), query));
    },
  });

  app.post('/households/:householdId/tasks', {
    ...household,
    handler: async (request, reply) => {
      const input = parseBody(request, createTaskSchema);
      const task = await container.tasks.create(context(request), input);
      return reply.status(201).send({ data: task });
    },
  });

  app.get('/households/:householdId/tasks/:taskId', {
    ...household,
    handler: async (request, reply) => {
      const { taskId } = parseParams(request, taskParams);
      return reply.send({ data: await container.tasks.get(context(request), taskId) });
    },
  });

  app.patch('/households/:householdId/tasks/:taskId', {
    ...household,
    handler: async (request, reply) => {
      const { taskId } = parseParams(request, taskParams);
      const input = parseBody(request, updateTaskSchema);
      return reply.send({ data: await container.tasks.update(context(request), taskId, input) });
    },
  });

  /**
   * The one-tap dashboard action, kept separate from PATCH so the client does
   * not have to know that completing a task also stamps who and when.
   */
  app.post('/households/:householdId/tasks/:taskId/complete', {
    ...household,
    handler: async (request, reply) => {
      const { taskId } = parseParams(request, taskParams);
      const { completed } = parseBody(request, completeTaskSchema);
      return reply.send({ data: await container.tasks.setCompleted(context(request), taskId, completed) });
    },
  });

  app.post('/households/:householdId/tasks/:taskId/stop-recurrence', {
    ...household,
    handler: async (request, reply) => {
      const { taskId } = parseParams(request, taskParams);
      await container.tasks.stopRecurrence(context(request), taskId);
      return reply.send({ data: { ok: true } });
    },
  });

  app.delete('/households/:householdId/tasks/:taskId', {
    ...household,
    handler: async (request, reply) => {
      const { taskId } = parseParams(request, taskParams);
      const { scope } = parseQuery(request, deleteQuery);
      await container.tasks.remove(context(request), taskId, scope);
      return reply.status(204).send();
    },
  });
}
