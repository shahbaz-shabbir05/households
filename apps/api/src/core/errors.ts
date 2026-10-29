/**
 * The application's error vocabulary. Every error that reaches the HTTP layer
 * is one of these; anything else is mapped to INTERNAL and logged, so an
 * unexpected failure can never leak a stack trace or a driver message to a
 * client (docs/06, docs/13).
 */

import type { ApiErrorCode, ApiErrorDetail } from '@hms/shared';

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly details?: ApiErrorDetail[];
  /** Context for the log line only — never serialised to the client. */
  readonly meta?: Record<string, unknown>;

  constructor(
    code: ApiErrorCode,
    statusCode: number,
    message: string,
    options: { details?: ApiErrorDetail[]; meta?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    if (options.details) this.details = options.details;
    if (options.meta) this.meta = options.meta;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details?: ApiErrorDetail[]) {
    super('VALIDATION_ERROR', 400, message, details ? { details } : {});
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'You need to sign in to do that') {
    super('UNAUTHENTICATED', 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that', meta?: Record<string, unknown>) {
    super('FORBIDDEN', 403, message, meta ? { meta } : {});
  }
}

/**
 * Also used deliberately for resources in *another* household. Returning 403
 * there would confirm the resource exists, which is an enumeration oracle
 * (docs/06).
 */
export class NotFoundError extends AppError {
  constructor(resource = 'Resource', meta?: Record<string, unknown>) {
    super('NOT_FOUND', 404, `${resource} not found`, meta ? { meta } : {});
  }
}

export class ConflictError extends AppError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super('CONFLICT', 409, message, meta ? { meta } : {});
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests — please slow down') {
    super('RATE_LIMITED', 429, message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'That file is too large') {
    super('PAYLOAD_TOO_LARGE', 413, message);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'That file type is not supported') {
    super('UNSUPPORTED_MEDIA_TYPE', 415, message);
  }
}

export class InternalError extends AppError {
  constructor(message = 'Something went wrong on our side', cause?: unknown) {
    super('INTERNAL', 500, message, cause !== undefined ? { cause } : {});
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Postgres unique-violation code, used to turn a race into a clean 409. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';

/**
 * Extracts a Postgres SQLSTATE from a thrown value.
 *
 * Walks the `cause` chain, because the query builder wraps driver errors: the
 * SQLSTATE lives on the cause, not the outer error. Reading only the top-level
 * `code` silently turns every constraint violation into a 500.
 */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;

  // Bounded, so a self-referencing cause cannot loop forever.
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    // SQLSTATE is always five characters, which distinguishes it from Node's
    // string error codes such as ECONNREFUSED.
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** The constraint name a violation names, when the driver reports one. */
export function pgConstraintName(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const constraint = (current as { constraint?: unknown }).constraint;
    if (typeof constraint === 'string') return constraint;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
