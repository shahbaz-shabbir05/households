/** Wire format shared by the server and the client (docs/06). */

export interface ListMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface SingleResponse<T> {
  data: T;
}

export interface ListResponse<T> {
  data: T[];
  meta: ListMeta;
}

/** A closed set: clients switch on `code`, never on `message` text. */
export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INTERNAL',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorDetail {
  path: string;
  message: string;
}

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ApiErrorDetail[];
    requestId?: string;
  };
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function buildListMeta(total: number, page: number, perPage: number): ListMeta {
  return { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}
