import type { FastifyInstance } from 'fastify';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from '@hms/shared';
import { eq } from 'drizzle-orm';
import { users } from '../../db/schema/index.js';
import type { Container } from '../../container.js';
import { createGuards, requestMeta, userContext } from '../../http/guards.js';
import { parseBody } from '../../http/validate.js';
import { clearSessionCookies, readSessionToken, setSessionCookie } from '../../http/session.js';

export async function registerAuthRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const { requireAuth } = createGuards(container);

  /**
   * Registration always returns 201 with the same shape, whether or not the
   * address was already taken. Telling the caller "this email exists" is an
   * account-enumeration leak; the address owner is emailed instead (docs/07).
   */
  app.post('/auth/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    handler: async (request, reply) => {
      const input = parseBody(request, registerSchema);
      const result = await container.auth.register(input, requestMeta(request));

      if (result) {
        setSessionCookie(reply, result.sessionToken, result.expiresAt);
        return reply.status(201).send({ data: { user: publicUser(result.user), created: true } });
      }
      return reply.status(201).send({ data: { user: null, created: false } });
    },
  });

  app.post('/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const input = parseBody(request, loginSchema);
      const result = await container.auth.login(input, requestMeta(request));
      setSessionCookie(reply, result.sessionToken, result.expiresAt);
      return reply.send({ data: { user: publicUser(result.user) } });
    },
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = readSessionToken(request);
    if (token) await container.auth.logout(token);
    clearSessionCookies(reply);
    return reply.send({ data: { ok: true } });
  });

  app.post('/auth/password/forgot', {
    config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
    handler: async (request, reply) => {
      const input = parseBody(request, forgotPasswordSchema);
      await container.auth.requestPasswordReset(input.email);
      // Always the same response — see above.
      return reply.send({
        data: { ok: true, message: 'If that address has an account, a reset link is on its way' },
      });
    },
  });

  app.post('/auth/password/reset', {
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    handler: async (request, reply) => {
      const input = parseBody(request, resetPasswordSchema);
      await container.auth.resetPassword(input);
      // Every session is gone, including this one.
      clearSessionCookies(reply);
      return reply.send({ data: { ok: true } });
    },
  });

  app.post('/auth/password/change', {
    preHandler: requireAuth,
    handler: async (request, reply) => {
      const ctx = userContext(request);
      const input = parseBody(request, changePasswordSchema);
      await container.auth.changePassword(ctx.user.id, input);
      clearSessionCookies(reply);
      return reply.send({ data: { ok: true } });
    },
  });

  app.post('/auth/email/verify', {
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    handler: async (request, reply) => {
      const input = parseBody(request, verifyEmailSchema);
      await container.auth.verifyEmail(input.token);
      return reply.send({ data: { ok: true } });
    },
  });

  app.post('/auth/email/resend', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
    handler: async (request, reply) => {
      const ctx = userContext(request);
      await container.auth.sendVerificationEmail(ctx.user.id, ctx.user.email);
      return reply.send({ data: { ok: true } });
    },
  });

  /** The client's bootstrap call: who am I, and which households can I open? */
  app.get('/me', {
    preHandler: requireAuth,
    handler: async (request, reply) => {
      const ctx = userContext(request);
      const [user, households] = await Promise.all([
        container.db.query.users.findFirst({ where: eq(users.id, ctx.user.id) }),
        container.households.listForUser(ctx.user.id),
      ]);

      return reply.send({
        data: {
          user: user
            ? {
                id: user.id,
                email: user.email,
                displayName: user.displayName,
                locale: user.locale,
                emailVerified: user.emailVerifiedAt !== null,
              }
            : null,
          households,
        },
      });
    },
  });

  app.patch('/me', {
    preHandler: requireAuth,
    handler: async (request, reply) => {
      const ctx = userContext(request);
      const input = parseBody(request, updateProfileSchema);
      const [updated] = await container.db
        .update(users)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(users.id, ctx.user.id))
        .returning();

      return reply.send({
        data: {
          id: updated!.id,
          email: updated!.email,
          displayName: updated!.displayName,
          locale: updated!.locale,
          emailVerified: updated!.emailVerifiedAt !== null,
        },
      });
    },
  });
}

function publicUser(user: { id: string; email: string; displayName: string; emailVerifiedAt: Date | null }) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerifiedAt !== null,
  };
}
