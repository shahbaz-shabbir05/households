/**
 * Request parsing.
 *
 * Every body, query and param is parsed by a Zod schema at the boundary and
 * unknown keys are dropped, so mass assignment cannot reach a column like
 * `role` or `household_id` that the caller was never allowed to set (docs/13).
 */

import type { FastifyRequest } from 'fastify';
import type { TypeOf, ZodTypeAny } from 'zod';
import { ZodError } from 'zod';
import { ValidationError } from '../core/errors.js';
import { zodDetails } from './errors.js';

function parse<S extends ZodTypeAny>(schema: S, value: unknown, source: string): TypeOf<S> {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ValidationError(`Invalid ${source}`, zodDetails(error));
    }
    throw error;
  }
}

export function parseBody<S extends ZodTypeAny>(request: FastifyRequest, schema: S): TypeOf<S> {
  return parse(schema, request.body ?? {}, 'request body');
}

export function parseQuery<S extends ZodTypeAny>(request: FastifyRequest, schema: S): TypeOf<S> {
  return parse(schema, request.query ?? {}, 'query parameters');
}

export function parseParams<S extends ZodTypeAny>(request: FastifyRequest, schema: S): TypeOf<S> {
  return parse(schema, request.params ?? {}, 'path parameters');
}
