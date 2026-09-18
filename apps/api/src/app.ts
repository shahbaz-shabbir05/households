/**
 * Fastify application assembly (docs/05).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import { config } from './config/index.js';
import { createContainer, type Container, type ContainerOverrides } from './container.js';
import { registerErrorHandler } from './http/errors.js';
import { assertCsrf } from './http/session.js';
import { assertMatrixIsComplete } from './core/policy/index.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerHouseholdRoutes } from './modules/households/routes.js';
import { registerMemberRoutes } from './modules/members/routes.js';
import { registerDashboardRoutes } from './modules/dashboard/routes.js';

export interface BuiltApp {
  app: FastifyInstance;
  container: Container;
}

export async function buildApp(overrides: ContainerOverrides = {}): Promise<BuiltApp> {
  const cfg = config();

  // Fail at boot, not at the first request, if a role was added without
  // deciding what it may do.
  assertMatrixIsComplete();

  const app = Fastify({
    logger: {
      level: cfg.LOG_LEVEL,
      // Bodies of auth, document and health routes are never logged; this
      // covers headers and any accidental inclusion (docs/13).
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'res.headers["set-cookie"]',
          'req.body.password',
          'req.body.newPassword',
          'req.body.currentPassword',
          'req.body.token',
        ],
        censor: '[redacted]',
      },
    },
    trustProxy: cfg.TRUST_PROXY,
    // Request ids appear in every log line and in every error response, so a
    // user-reported failure can be found in the logs.
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  await app.register(cors, {
    // An explicit allow-list: credentials are sent, so `*` is not an option.
    origin: cfg.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-csrf-token'],
  });

  await app.register(cookie, { secret: cfg.SESSION_SECRET });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // Per-user where we know who it is, per-IP otherwise: a family behind one
    // NAT address should not rate-limit each other.
    keyGenerator: (request) => request.userCtx?.user.id ?? request.ip,
  });

  const container = createContainer(app.log, overrides);

  registerErrorHandler(app);

  app.addHook('preHandler', async (request) => {
    assertCsrf(request);
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    try {
      await container.db.execute(sql`SELECT 1`);
      return reply.send({ status: 'ok', database: 'reachable' });
    } catch {
      return reply.status(503).send({ status: 'unavailable', database: 'unreachable' });
    }
  });

  await app.register(
    async (api) => {
      await registerAuthRoutes(api, container);
      await registerHouseholdRoutes(api, container);
      await registerMemberRoutes(api, container);
      await registerDashboardRoutes(api, container);
    },
    { prefix: '/api/v1' },
  );

  return { app, container };
}
