import type { FastifyInstance } from 'fastify';
import type { Container } from '../../container.js';
import { context, createGuards } from '../../http/guards.js';

export async function registerDashboardRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const { requireAuth, requireHousehold } = createGuards(container);

  app.get('/households/:householdId/dashboard', {
    preHandler: [requireAuth, requireHousehold],
    handler: async (request, reply) => {
      const { summary, failures } = await container.dashboard.summary(context(request));

      // A contributor that failed degrades one section; it must not blank the
      // screen, but it must be visible in the logs — under this request's own
      // household and request id.
      if (failures.length > 0) {
        request.log.error({ failures }, 'dashboard contributor failed');
      }
      return reply.send({ data: summary });
    },
  });
}
