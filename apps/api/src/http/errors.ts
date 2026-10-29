/**
 * Maps any thrown value to the API's error envelope.
 *
 * Everything that is not an `AppError` becomes a generic INTERNAL response:
 * driver messages, stack traces and constraint names never reach a client
 * (docs/13).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { ApiErrorDetail, ApiErrorResponse } from '@hms/shared';
import {
  AppError,
  ConflictError,
  InternalError,
  PG_CHECK_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
  ValidationError,
  isAppError,
  pgErrorCode,
} from '../core/errors.js';

export function zodDetails(error: ZodError): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

function normalise(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof ZodError) {
    return new ValidationError('Request validation failed', zodDetails(error));
  }

  switch (pgErrorCode(error)) {
    case PG_UNIQUE_VIOLATION:
      return new ConflictError('That already exists');
    case PG_FOREIGN_KEY_VIOLATION:
      return new ValidationError('That refers to something which does not exist');
    case PG_CHECK_VIOLATION:
      return new ValidationError('That value is not allowed');
  }

  // Fastify's own errors carry a statusCode; respect it but do not echo the body.
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const status = Number((error as { statusCode: unknown }).statusCode);
    if (status === 413) return new AppError('PAYLOAD_TOO_LARGE', 413, 'That request is too large');
    if (status === 415) return new AppError('UNSUPPORTED_MEDIA_TYPE', 415, 'Unsupported content type');
    if (status === 429) return new AppError('RATE_LIMITED', 429, 'Too many requests — please slow down');
    if (status === 400) return new ValidationError('That request could not be understood');
  }

  return new InternalError('Something went wrong on our side', error);
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
    const appError = normalise(error);

    if (appError.statusCode >= 500) {
      request.log.error({ err: error, requestId: request.id }, 'unhandled error');
    } else {
      request.log.info(
        { code: appError.code, status: appError.statusCode, meta: appError.meta, requestId: request.id },
        'request rejected',
      );
    }

    const body: ApiErrorResponse = {
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details ? { details: appError.details } : {}),
        requestId: String(request.id),
      },
    };
    return reply.status(appError.statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ApiErrorResponse = {
      error: {
        code: 'NOT_FOUND',
        message: 'That endpoint does not exist',
        requestId: String(request.id),
      },
    };
    return reply.status(404).send(body);
  });
}
