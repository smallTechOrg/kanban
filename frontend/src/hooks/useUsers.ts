/**
 * The user directory queries. `WorkspaceMembersPage` lists every registered user
 * (Section 2.2: `GET /api/users?limit=500`, query key `['users', 'all']`), and
 * `ShareBoardModal`'s search box asks the same endpoint with a `q` (Sections 2.3.1 and 4.2).
 *
 * The debounce and the minimum term live here rather than in the modal, for the reason
 * `useSearch` gives for the card search: a component that owned its own timer would hold
 * server state in a `useState`, and "how long to wait" is one rule about a typed query. The
 * 250 ms is that same rule, imported rather than restated.
 */
import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { listUsers } from '@/api/users';
import type { PublicUser, UserList } from '@/api/types';
import { SEARCH_DEBOUNCE_MS } from './useSearch';

const ALL_USERS_KEY = ['users', 'all'] as const;

/** Section 4.2 caps `limit` at 500, and v1 has no pagination above it. */
const WORKSPACE_LIMIT = 500;

/** `GET /api/users` rejects a `q` shorter than two characters (Section 4.2). */
export const MIN_USER_QUERY_LENGTH = 2;

/** A directory search is re-read whenever the modal is opened again. */
const USERS_STALE_MS = 10_000;

const selectItems = (data: UserList): PublicUser[] => data.items;

/** Every registered user, already ordered by full name by the server. */
export function useAllUsers(): UseQueryResult<PublicUser[], Error> {
  return useQuery({
    queryKey: ALL_USERS_KEY,
    queryFn: () => listUsers({ limit: WORKSPACE_LIMIT }),
    select: selectItems,
  });
}

export interface UserSearchState {
  /** The rows for the debounced term; empty until two characters have been typed. */
  users: PublicUser[];
  /** The debounced term the rows belong to, for the "nobody matches …" line. */
  term: string;
  /** False while fewer than two characters are typed, when nothing is sent. */
  isEnabled: boolean;
  isFetching: boolean;
}

/** `GET /api/users?q=` — the debounced directory search behind `ShareBoardModal`. */
export function useUserSearch(input: string): UserSearchState {
  const typed = input.trim();
  const [term, setTerm] = useState(typed);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(typed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const isEnabled = term.length >= MIN_USER_QUERY_LENGTH;
  const { data, isFetching } = useQuery({
    queryKey: ['users', 'search', term] as const,
    queryFn: () => listUsers({ q: term }),
    enabled: isEnabled,
    placeholderData: keepPreviousData,
    staleTime: USERS_STALE_MS,
    select: selectItems,
  });

  return {
    users: isEnabled ? (data ?? []) : [],
    term,
    isEnabled,
    isFetching: isEnabled && isFetching,
  };
}
