/**
 * The API client.
 *
 * Thin on purpose: it attaches credentials and the CSRF header, unwraps the
 * `{ data }` / `{ error }` envelope, and turns failures into a typed error the
 * UI can switch on (docs/11).
 */

import type { ApiErrorCode, ApiErrorDetail, ListMeta } from '@hms/shared';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly details?: ApiErrorDetail[],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field errors keyed by path, for rendering next to the offending input. */
  get fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const detail of this.details ?? []) {
      map[detail.path] ??= detail.message;
    }
    return map;
  }
}

const BASE = '/api/v1';
const SAFE_METHODS = new Set(['GET', 'HEAD']);

/** Read the non-httpOnly CSRF cookie the server issued alongside the session. */
function csrfToken(): string | null {
  const match = /(?:^|;\s*)hms_csrf=([^;]+)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

type UnauthenticatedHandler = () => void;
let onUnauthenticated: UnauthenticatedHandler = () => {};

export function setUnauthenticatedHandler(handler: UnauthenticatedHandler): void {
  onUnauthenticated = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};

  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (!SAFE_METHODS.has(method)) {
    const token = csrfToken();
    if (token) headers['x-csrf-token'] = token;
  }

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = payload?.error;
    // Fired once, centrally — not per in-flight request, which would cause a
    // redirect storm when several queries fail together.
    if (response.status === 401) onUnauthenticated();
    throw new ApiError(
      error?.code ?? 'INTERNAL',
      error?.message ?? 'Something went wrong',
      response.status,
      error?.details,
      error?.requestId,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    request<{ data: T }>(path, signal ? { signal } : {}).then((r) => r.data),

  getList: <T>(path: string, signal?: AbortSignal) =>
    request<{ data: T[]; meta: ListMeta }>(path, signal ? { signal } : {}),

  post: <T>(path: string, body?: unknown) =>
    request<{ data: T }>(path, { method: 'POST', body }).then((r) => r?.data),

  patch: <T>(path: string, body: unknown) =>
    request<{ data: T }>(path, { method: 'PATCH', body }).then((r) => r.data),

  delete: (path: string) => request<void>(path, { method: 'DELETE' }),
};

/** Builds a query string, omitting empty values so URLs stay readable. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
