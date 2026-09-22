import { buildListMeta, type ListMeta } from '@hms/shared';
import { ValidationError } from './errors.js';

export interface PageRequest {
  page: number;
  perPage: number;
}

export function offsetOf(page: PageRequest): number {
  return (page.page - 1) * page.perPage;
}

export function paginated<T>(rows: T[], total: number, page: PageRequest): { data: T[]; meta: ListMeta } {
  return { data: rows, meta: buildListMeta(total, page.page, page.perPage) };
}

/**
 * Resolves a client-supplied sort field against an allow-list.
 *
 * Sort and filter columns are never interpolated from user input — that is a
 * direct SQL-injection route and a way to force an unindexed scan (docs/13).
 */
export function resolveSort<T extends Record<string, unknown>>(
  requested: string | undefined,
  allowed: T,
  fallback: keyof T,
): T[keyof T] {
  if (!requested) return allowed[fallback];
  if (!Object.hasOwn(allowed, requested)) {
    throw new ValidationError(`Cannot sort by "${requested}"`, [
      { path: 'sort', message: `Allowed values: ${Object.keys(allowed).join(', ')}` },
    ]);
  }
  return allowed[requested as keyof T];
}
