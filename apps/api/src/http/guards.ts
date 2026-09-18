/**
 * Route guards.
 *
 * `requireAuth` resolves the session; `requireHousehold` resolves membership
 * and builds the `RequestContext` every service depends on. A handler that is
 * registered behind these can assume both exist (docs/05).
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NotFoundError, UnauthenticatedError } from '../core/errors.js';
import type { RequestContext, UserContext } from '../core/request-context.js';
import type { Container } from '../container.js';
import { readSessionToken } from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    userCtx?: UserContext;
    ctx?: RequestContext;
  }
}

const householdParamsSchema = z.object({ householdId: z.string().uuid() });

function requestMeta(request: FastifyRequest): { ip: string | null; userAgent: string | null } {
  return {
    ip: request.ip ?? null,
    userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
  };
}

export function createGuards(container: Container) {
  async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const token = readSessionToken(request);
    if (!token) throw new UnauthenticatedError();

    const user = await container.auth.resolveSession(token);
    if (!user) throw new UnauthenticatedError('Your session has expired — please sign in again');

    request.userCtx = {
      requestId: String(request.id),
      user: { id: user.id, email: user.email, displayName: user.displayName },
      ...requestMeta(request),
    };
  }

  /**
   * Resolves the household in the path. A household the user is not a member of
   * produces 404, never 403: a 403 would confirm that the id exists, which is
   * an enumeration oracle (docs/06).
   */
  async function requireHousehold(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!request.userCtx) throw new UnauthenticatedError();

    const { householdId } = householdParamsSchema.parse(request.params);
    const membership = await container.households.resolveMembership(request.userCtx.user.id, householdId);
    if (!membership) throw new NotFoundError('Household');

    request.ctx = {
      requestId: request.userCtx.requestId,
      user: request.userCtx.user,
      household: membership.household,
      member: membership.member,
      ip: request.userCtx.ip,
      userAgent: request.userCtx.userAgent,
    };
  }

  return { requireAuth, requireHousehold };
}

/** Narrowing helpers so handlers do not repeat non-null assertions. */
export function userContext(request: FastifyRequest): UserContext {
  if (!request.userCtx) throw new UnauthenticatedError();
  return request.userCtx;
}

export function context(request: FastifyRequest): RequestContext {
  if (!request.ctx) throw new UnauthenticatedError();
  return request.ctx;
}

export { requestMeta };
