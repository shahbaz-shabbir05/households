import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { notifications } from '../../db/schema/index.js';
import type { Container } from '../../container.js';
import { context, createGuards } from '../../http/guards.js';
import { parseBody, parseQuery } from '../../http/validate.js';

const listQuery = z.object({
  unreadOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

const markReadBody = z.object({
  notificationIds: z.array(z.string().uuid()).min(1).max(200),
});

export async function registerNotificationRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const { requireAuth, requireHousehold } = createGuards(container);
  const household = { preHandler: [requireAuth, requireHousehold] };

  /** A member's own inbox. There is no route to read anyone else's. */
  app.get('/households/:householdId/notifications', {
    ...household,
    handler: async (request, reply) => {
      const ctx = context(request);
      const query = parseQuery(request, listQuery);

      const rows = await container.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.memberId, ctx.member.id),
            query.unreadOnly ? isNull(notifications.readAt) : undefined,
          ),
        )
        .orderBy(desc(notifications.createdAt))
        .limit(query.limit);

      return reply.send({
        data: rows.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          priority: n.priority,
          entityType: n.entityType,
          entityId: n.entityId,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        })),
      });
    },
  });

  app.post('/households/:householdId/notifications/read', {
    ...household,
    handler: async (request, reply) => {
      const ctx = context(request);
      const { notificationIds } = parseBody(request, markReadBody);
      // Scoped to the caller's own member id, so ids belonging to someone else
      // simply do not match.
      const updated = await container.notifications.markRead(container.db, ctx.member.id, notificationIds);
      return reply.send({ data: { updated } });
    },
  });
}
