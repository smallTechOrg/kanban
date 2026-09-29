/**
 * The only place the browser talks to the server (CLAUDE.md section 3).
 *
 * Every mutating request carries the `X-Requested-With: fetch` CSRF header the backend demands
 * on every non-GET `/api` call (Section 4.1). Non-2xx responses become a typed `ApiError` built
 * from the one error envelope. A 503 — the busy write lock of Section 4.1 — is retried once
 * after its `Retry-After` before it is raised, which is the one retry Section 2.10 puts in front
 * of an optimistic rollback.
 */
import type { ErrorDetails, ErrorEnvelope } from './types';

const API_BASE = '/api';
const CSRF_HEADER_NAME = 'X-Requested-With';
const CSRF_HEADER_VALUE = 'fetch';
const REQUEST_ID_HEADER = 'X-Request-Id';
const RETRY_AFTER_HEADER = 'Retry-After';
/** The busy write lock of Section 4.1, the one status the client retries (Section 2.10). */
const LOCK_TIMEOUT_STATUS = 503;

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiErrorInit {
  status: number;
  code: string;
  message: string;
  request_id: string | null;
  details: ErrorDetails;
}

/** Every failed call rejects with this; `code` is the envelope's machine-readable code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly request_id: string | null;
  readonly details: ErrorDetails;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.request_id = init.request_id;
    this.details = init.details;
  }
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const { error } = value as { error: unknown };
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

/** Turns a failed response (fetch or XHR) into an ApiError. Shared by both transports. */
function toApiError(status: number, requestId: string | null, rawBody: string): ApiError {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (isErrorEnvelope(parsed)) {
      const { code, message, details, request_id } = parsed.error;
      return new ApiError({
        status,
        code,
        message,
        request_id: request_id ?? requestId,
        details: details ?? null,
      });
    }
  } catch {
    // Not JSON (a proxy error page, an empty body): fall through to the generic shape.
  }
  return new ApiError({
    status,
    code: 'internal_error',
    message: `Request failed with status ${status}`,
    request_id: requestId,
    details: null,
  });
}

/** Section 2.10 "503 lock timeout": how long to wait when the server named no `Retry-After`. */
const LOCK_RETRY_MS = 1000;

/** The server's `Retry-After` in milliseconds, or the documented one second. */
function retryDelayMs(response: Response): number {
  const header = response.headers.get(RETRY_AFTER_HEADER);
  if (header === null) return LOCK_RETRY_MS;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : LOCK_RETRY_MS;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function attempt(method: HttpMethod, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {
    [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';

  return fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function fail(response: Response): Promise<never> {
  throw toApiError(response.status, response.headers.get(REQUEST_ID_HEADER), await response.text());
}

/**
 * One request, with the single retry Section 2.10 gives a 503: a write that lost the race for
 * SQLite's write lock is sent again after the server's `Retry-After` (1 s) before the caller
 * rolls its optimistic change back and shows "The board is busy, please retry."
 * (`hooks/mutationErrors.ts`). Exactly one retry, and only for 503, so a server that is down
 * still fails at once.
 */
async function send(method: HttpMethod, path: string, body?: unknown): Promise<Response> {
  const response = await attempt(method, path, body);
  if (response.ok) return response;
  if (response.status !== LOCK_TIMEOUT_STATUS) return fail(response);

  await wait(retryDelayMs(response));
  const retried = await attempt(method, path, body);
  return retried.ok ? retried : fail(retried);
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** The multipart field every upload route reads the body from (Sections 4.6 and 6.9). */
const UPLOAD_FIELD = 'file';

/** What `upload.onprogress` reports while the bytes are on the wire (Section 5.8). */
export interface UploadProgress {
  loaded: number;
  total: number;
  /** `loaded / total` in `0..1`, or `null` until the browser knows the total. */
  fraction: number | null;
}

export interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void;
}

/**
 * The one multipart transport (Section 5.8). `fetch` cannot report upload progress, so an
 * upload goes out over `XMLHttpRequest` with the same `X-Requested-With` CSRF header and the
 * same error envelope as every JSON call above — which is why it lives here and not in
 * `api/attachments.ts`: turning a failed response into an `ApiError` is one rule.
 *
 * `Content-Type` is deliberately not set: the browser has to add the multipart boundary.
 */
export function uploadFile<T>(path: string, file: File, options: UploadOptions = {}): Promise<T> {
  const { onProgress } = options;
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const body = new FormData();
    body.append(UPLOAD_FIELD, file, file.name);

    request.open('POST', `${API_BASE}${path}`);
    request.setRequestHeader(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);
    request.setRequestHeader('Accept', 'application/json');

    if (onProgress !== undefined) {
      request.upload.addEventListener('progress', (event) => {
        onProgress({
          loaded: event.loaded,
          total: event.total,
          fraction: event.lengthComputable && event.total > 0 ? event.loaded / event.total : null,
        });
      });
    }
    request.addEventListener('load', () => {
      const requestId = request.getResponseHeader(REQUEST_ID_HEADER);
      if (request.status >= 200 && request.status < 300) {
        try {
          resolve(JSON.parse(request.responseText) as T);
        } catch {
          reject(toApiError(request.status, requestId, request.responseText));
        }
        return;
      }
      reject(toApiError(request.status, requestId, request.responseText));
    });
    request.addEventListener('error', () => {
      reject(
        new ApiError({
          status: 0,
          code: 'network_error',
          message: 'The upload could not reach the server.',
          request_id: null,
          details: null,
        }),
      );
    });

    request.send(body);
  });
}

/** JSON helpers. Resource modules (`api/meta.ts`, `api/boards.ts`, ...) build on these. */
export const api = {
  get: <T>(path: string): Promise<T> => send('GET', path).then((r) => readJson<T>(r)),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    send('POST', path, body).then((r) => readJson<T>(r)),
  put: <T>(path: string, body?: unknown): Promise<T> =>
    send('PUT', path, body).then((r) => readJson<T>(r)),
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    send('PATCH', path, body).then((r) => readJson<T>(r)),
  del: async (path: string): Promise<void> => {
    await send('DELETE', path);
  },
  /**
   * The few `DELETE` routes that answer 200 with a document instead of 204: detaching a label
   * returns the card's whole `label_ids` array and clearing a cover returns the card (Sections
   * 4.5 and 4.6), so the caller needs the body. `del` stays the 204 form every other delete uses.
   */
  delJson: <T>(path: string): Promise<T> => send('DELETE', path).then((r) => readJson<T>(r)),
};
