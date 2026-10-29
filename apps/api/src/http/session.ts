/**
 * Session cookie and CSRF plumbing (docs/07).
 *
 * The session cookie is httpOnly so script cannot read it; the CSRF cookie
 * deliberately is not, because the client must echo it in a header. `SameSite`
 * blocks the common case and the double-submit token covers what it misses.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/index.js';
import { generateCsrfToken, tokensMatch } from '../core/tokens.js';
import { ForbiddenError } from '../core/errors.js';

export const SESSION_COOKIE = 'hms_session';
export const CSRF_COOKIE = 'hms_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function baseCookieOptions() {
  const cfg = config();
  return {
    path: '/',
    secure: cfg.COOKIE_SECURE,
    sameSite: 'lax' as const,
    ...(cfg.COOKIE_DOMAIN ? { domain: cfg.COOKIE_DOMAIN } : {}),
  };
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    ...baseCookieOptions(),
    httpOnly: true,
    expires: expiresAt,
  });

  // Issued alongside the session so the client always has a matching pair.
  reply.setCookie(CSRF_COOKIE, generateCsrfToken(), {
    ...baseCookieOptions(),
    httpOnly: false,
    expires: expiresAt,
  });
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, baseCookieOptions());
  reply.clearCookie(CSRF_COOKIE, baseCookieOptions());
}

export function readSessionToken(request: FastifyRequest): string | null {
  return request.cookies[SESSION_COOKIE] ?? null;
}

/**
 * Double-submit check on every state-changing request.
 *
 * Only enforced when a session cookie is present: unauthenticated endpoints
 * such as login and password reset have nothing to forge, and requiring a token
 * there would just break the first request a client ever makes.
 */
export function assertCsrf(request: FastifyRequest): void {
  if (SAFE_METHODS.has(request.method)) return;
  if (!request.cookies[SESSION_COOKIE]) return;

  const cookieToken = request.cookies[CSRF_COOKIE];
  const headerToken = request.headers[CSRF_HEADER];

  if (!cookieToken || typeof headerToken !== 'string' || !tokensMatch(cookieToken, headerToken)) {
    throw new ForbiddenError('Missing or invalid CSRF token');
  }
}
