/**
 * Opaque secret tokens for sessions, invites, password resets and email
 * verification.
 *
 * Only the hash is ever stored, so a database leak yields nothing usable. The
 * hash is a keyed HMAC rather than a bare SHA-256, so an attacker with the
 * database but not the application secret cannot even build a rainbow table of
 * candidate tokens.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config/index.js';

const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
  return createHmac('sha256', config().SESSION_SECRET).update(token).digest('base64url');
}

export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** A CSRF token: random, not secret-derived, compared by double-submit (docs/07). */
export function generateCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}

export function addDaysToNow(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

export function addHoursToNow(hours: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + hours * 3_600_000);
}
