/**
 * `GET /api/users` (Section 4.2) — the directory behind `WorkspaceMembersPage` and, from
 * M3, the Members and Share popovers. Rows are `PublicUser`: never another user's email.
 */
import { api } from './client';
import type { UserList } from './types';

export interface ListUsersParams {
  /** Substring of `username` or `full_name`; the server rejects one shorter than 2 chars. */
  q?: string;
  /** 1-500, default 20 server-side. `WorkspaceMembersPage` asks for 500 (no pagination in v1). */
  limit?: number;
}

/** Without `q` every registered user comes back ordered by `full_name COLLATE NOCASE`. */
export function listUsers({ q, limit }: ListUsersParams = {}): Promise<UserList> {
  const entries: Array<[string, string]> = [];
  if (q !== undefined && q !== '') entries.push(['q', q]);
  if (limit !== undefined) entries.push(['limit', String(limit)]);
  const query = new URLSearchParams(entries).toString();
  return api.get<UserList>(query === '' ? '/users' : `/users?${query}`);
}
