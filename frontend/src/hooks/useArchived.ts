/**
 * `['archived', boardId, type, q]` — the two paged listings of `ArchivedItemsPanel` and the
 * prefix every restore invalidates (Sections 5.4.1, 4.3 and 2.3.4).
 *
 * An archive or a restore changes both the archived listing of Section 4.3 and the board, and the
 * endpoints answer with the card or list only (`Mutated<T>`), never with the page it left. So the
 * mutation hooks write the board cache themselves and invalidate the `['archived', boardId]`
 * prefix, which is what makes a restored row leave the panel without the caller knowing which
 * filter is open: the prefix matches whatever `type` and `q` the panel is paging under.
 *
 * The panel's search field is debounced here rather than in the component, so the key changes once
 * per pause instead of once per keystroke, and both listings share that rule.
 */
import { useEffect, useState } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { getArchivedCards, getArchivedLists } from '@/api/boards';
import type { ArchivedCards, ArchivedLists, ArchivedType } from '@/api/types';
import { isId } from '@/lib/boardState';

/** The prefix both listings of one board share, and the only thing a restore invalidates. */
function archivedBoardKey(boardId: number): readonly ['archived', number] {
  return ['archived', boardId] as const;
}

/** The full key of Section 5.4.1: the prefix above plus the panel's switch and its search. */
export function archivedKey(
  boardId: number,
  type: ArchivedType,
  q: string,
): readonly ['archived', number, ArchivedType, string] {
  return ['archived', boardId, type, q] as const;
}

/**
 * Refetch both archived listings of a board. Called by every mutation that moves a row across
 * the archive line, since no such response carries the page the row belongs to.
 */
export function invalidateArchived(queryClient: QueryClient, boardId: number): void {
  void queryClient.invalidateQueries({ queryKey: archivedBoardKey(boardId) });
}

/** The cursor: a `cards.id` / `lists.id`, or `undefined` for the newest page. */
export type ArchivedPageParam = number | undefined;

/** What one archived listing holds. */
export type ArchivedCardPages = InfiniteData<ArchivedCards, ArchivedPageParam>;
export type ArchivedListPages = InfiniteData<ArchivedLists, ArchivedPageParam>;

/** The panel is a read of rows the board query does not carry, so it keeps its own window. */
const STALE_MS = 10_000;

/** The pause after the last keystroke before the archive search asks the server again. */
const SEARCH_DEBOUNCE_MS = 250;

/** The typed text, settled: one value change per pause, which is one query key per pause. */
function useDebouncedText(value: string, delay = SEARCH_DEBOUNCE_MS): string {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}

/** The options both listings share: the same key shape, cursor and freshness window. */
function archivedOptions<TPage extends { items: unknown[]; next_before: number | null }>(
  boardId: number,
  type: ArchivedType,
  q: string,
  fetchPage: (before: ArchivedPageParam) => Promise<TPage>,
  enabled: boolean,
) {
  return {
    queryKey: archivedKey(boardId, type, q),
    queryFn: ({ pageParam }: { pageParam: ArchivedPageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as ArchivedPageParam,
    getNextPageParam: (lastPage: TPage) => lastPage.next_before ?? undefined,
    enabled: enabled && isId(boardId),
    staleTime: STALE_MS,
    // Typing in the search field must not blank the rows that are already on screen.
    placeholderData: keepPreviousData,
  };
}

/**
 * `GET /api/boards/{board_id}/archived?type=cards&q=` — the panel's "Cards" half, newest first.
 * `q` is the raw input: it is debounced here, so the caller may pass it on every keystroke.
 */
export function useArchivedCards(
  boardId: number,
  q: string,
  enabled = true,
): UseInfiniteQueryResult<ArchivedCardPages, Error> {
  const settled = useDebouncedText(q);
  return useInfiniteQuery(
    archivedOptions<ArchivedCards>(
      boardId,
      'cards',
      settled,
      (before) => getArchivedCards(boardId, { q: settled, before }),
      enabled,
    ),
  );
}

/** The same listing for the "Lists" half; an archived list comes back with its cards. */
export function useArchivedLists(
  boardId: number,
  q: string,
  enabled = true,
): UseInfiniteQueryResult<ArchivedListPages, Error> {
  const settled = useDebouncedText(q);
  return useInfiniteQuery(
    archivedOptions<ArchivedLists>(
      boardId,
      'lists',
      settled,
      (before) => getArchivedLists(boardId, { q: settled, before }),
      enabled,
    ),
  );
}
