/**
 * `GET /api/search` — the one endpoint behind `SearchPopover` (Sections 2.1.1 and 4.7).
 *
 * The typed text is sent raw: the server owns the FTS5 sanitising (`"term"*` prefix tokens) and
 * answers `{boards: [], cards: []}` for a query that tokenises to nothing, so there is no
 * client-side syntax to get wrong and no query the popover has to refuse. Only the two bounds the
 * router validates are written here, and `hooks/useSearch.ts` is the only caller.
 */
import { api } from './client';
import type { SearchResults } from './types';

/** `GET /api/search?limit=` (Section 4.7); the router caps it at 50. */
export const DEFAULT_SEARCH_LIMIT = 20;

/** `q` is at most 200 characters (Section 4.7); longer is a 422, so the caller's text is cut. */
export const MAX_QUERY_LENGTH = 200;

/**
 * `GET /api/search?q=&limit=` — matching boards and cards, both restricted by the server to the
 * caller's own open boards. `board_id` is not sent: the popover searches everywhere (2.1.1).
 */
export function search(q: string, limit = DEFAULT_SEARCH_LIMIT): Promise<SearchResults> {
  const params = new URLSearchParams({ q: q.slice(0, MAX_QUERY_LENGTH), limit: String(limit) });
  return api.get<SearchResults>(`/search?${params.toString()}`);
}
