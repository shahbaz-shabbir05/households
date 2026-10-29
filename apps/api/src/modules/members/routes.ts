import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  acceptInviteSchema,
  createInviteSchema,
  createMemberSchema,
  listMembersQuerySchema,
  updateMemberSchema,
} from '@hms/shared';
import type { Container } from '../../container.js';
import { context, createGuards, userContext } from '../../http/guards.js';
import { parseBody, parseParams, parseQuery } from '../../http/validate.js';

const memberParams = z.object({ memberId: z.string().uuid() });

export async function registerMemberRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const { requireAuth, requireHousehold } = createGuards(container);
  const household = { preHandler: [requireAuth, requireHousehold] };

  app.get('/households/:householdId/members', {
    ...household,
    handler: async (request, reply) => {
      const query = parseQuery(request, listMembersQuerySchema);
      return reply.send({ data: await container.members.list(context(request), query) });
    },
  });

  app.post('/households/:householdId/members', {
    ...household,
    handler: async (request, reply) => {
      const input = parseBody(request, createMemberSchema);
      const member = await container.members.create(context(request), input);
      return reply.status(201).send({ data: member });
    },
  });

  app.get('/households/:householdId/members/:memberId', {
    ...household,
    handler: async (request, reply) => {
      const { memberId } = parseParams(request, memberParams);
      return reply.send({ data: await container.members.get(context(request), memberId) });
    },
  });

  app.patch('/households/:householdId/members/:memberId', {
    ...household,
    handler: async (request, reply) => {
      const { memberId } = parseParams(request, memberParams);
      const input = parseBody(request, updateMemberSchema);
      return reply.send({ data: await container.members.update(context(request), memberId, input) });
    },
  });

  app.delete('/households/:householdId/members/:memberId', {
    ...household,
    handler: async (request, reply) => {
      const { memberId } = parseParams(request, memberParams);
      await container.members.deactivate(context(request), memberId);
      return reply.status(204).send();
    },
  });

  app.post('/households/:householdId/invites', {
    ...household,
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    handler: async (request, reply) => {
      const input = parseBody(request, createInviteSchema);
      await container.members.invite(context(request), container.mailer, input);
      return reply.status(202).send({ data: { ok: true } });
    },
  });

  /** Not household-scoped: the invitee does not yet belong to the household. */
  app.post('/invites/accept', {
    preHandler: requireAuth,
    handler: async (request, reply) => {
      const input = parseBody(request, acceptInviteSchema);
      const result = await container.members.acceptInvite(userContext(request), input);
      return reply.send({ data: result });
    },
  });
}
