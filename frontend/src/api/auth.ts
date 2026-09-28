/**
 * The auth and profile endpoints of Section 4.2. Every call goes through `client.ts`,
 * which sends the `kb_session` cookie and the `X-Requested-With: fetch` CSRF header.
 */
import { api } from './client';
import type { User } from './types';

export interface RegisterInput {
  email: string;
  username: string;
  full_name: string;
  /** 8-128 characters (Section 4.1). */
  password: string;
}

export interface LoginInput {
  email_or_username: string;
  password: string;
}

/** `token` is the raw bearer token for scripts; the SPA rides the cookie and ignores it. */
export interface LoginResult {
  user: User;
  token: string;
}

/** `password` requires a matching `current_password`; every field is optional. */
export interface ProfileInput {
  full_name?: string;
  avatar_color?: string;
  password?: string;
  current_password?: string;
}

/** `POST /api/auth/register` — 201 plus the session cookie. 403 when signup is disabled. */
export function register(input: RegisterInput): Promise<User> {
  return api.post<User>('/auth/register', input);
}

/** `POST /api/auth/login` — 200 plus the session cookie. 401 on bad credentials, 429 when throttled. */
export function login(input: LoginInput): Promise<LoginResult> {
  return api.post<LoginResult>('/auth/login', input);
}

/**
 * `POST /api/auth/logout` — deletes the session row and expires the cookie.
 *
 * The route answers 204 while `client.ts` parses every response body, so the empty body
 * raises a `SyntaxError` *after* the request has already succeeded. That one is swallowed;
 * an `ApiError` from a non-2xx status still rejects.
 */
export async function logout(): Promise<void> {
  try {
    await api.post<null>('/auth/logout');
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
}

/** `GET /api/auth/me` — the first call on app boot; 401 means "not signed in". */
export function getMe(): Promise<User> {
  return api.get<User>('/auth/me');
}

/** `PATCH /api/auth/me` — backs `ProfileModal`. 400 when `current_password` does not match. */
export function updateProfile(input: ProfileInput): Promise<User> {
  return api.patch<User>('/auth/me', input);
}
