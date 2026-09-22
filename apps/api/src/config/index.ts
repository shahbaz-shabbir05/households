/**
 * Configuration is read from the environment once, validated, and frozen.
 *
 * The process deliberately refuses to start when production config is missing
 * or left at a development default: a deployment that fails loudly is far
 * better than one that runs insecurely (docs/14).
 */

import { z } from 'zod';
import { loadEnvFile } from './load-env.js';

const DEV_SESSION_SECRET = 'dev-only-insecure-secret-change-me';

/**
 * An environment flag.
 *
 * Never `z.coerce.boolean()`: that is `Boolean(value)`, so `TRUST_PROXY=false`
 * in a .env file parses as **true** — which would make `request.ip` read from
 * a client-supplied X-Forwarded-For header, handing anyone a way past the
 * per-IP rate limits on login and password reset.
 */
const envBoolean = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
    .transform((v) => v === 'true' || v === '1' || v === 'yes' || v === 'on')
    .default(String(defaultValue) as 'true' | 'false');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    /** Used to derive token-hashing keys. Must be overridden in production. */
    SESSION_SECRET: z.string().min(32).default(DEV_SESSION_SECRET),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
    COOKIE_DOMAIN: z.string().optional(),
    /** Off in development so the app works over plain http://localhost. */
    COOKIE_SECURE: envBoolean(false),

    /** Exact origins allowed to call the API with credentials. Never `*`. */
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

    APP_URL: z.string().url().default('http://localhost:5173'),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_ROOT: z.string().default('./storage'),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),

    EMAIL_DRIVER: z.enum(['console', 'smtp']).default('console'),
    EMAIL_FROM: z.string().default('Home Management System <no-reply@localhost>'),

    /** Lets a web instance run without the scheduler (docs/14). */
    JOBS_ENABLED: envBoolean(true),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: envBoolean(false),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV !== 'production') return;

    if (cfg.SESSION_SECRET === DEV_SESSION_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SESSION_SECRET'],
        message: 'SESSION_SECRET must be set to a unique value in production',
      });
    }
    if (!cfg.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true in production — session cookies require HTTPS',
      });
    }
    if (cfg.CORS_ORIGINS.some((o) => o.startsWith('http://') && !o.includes('localhost'))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'Production CORS origins must use HTTPS',
      });
    }
  });

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  loadEnvFile();
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${details}`);
  }
  return Object.freeze(parsed.data);
}

export function config(): Config {
  cached ??= loadConfig();
  return cached;
}

/** Test-only escape hatch so a suite can exercise alternative configurations. */
export function resetConfigCache(): void {
  cached = null;
}
