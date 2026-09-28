/**
 * The board query and the selectors the board page reads it through (Section 5.4).
 *
 * `['board', boardId]` is the key of Section 5.4.1. Its `queryFn` normalises the payload once
 * per response (`lib/normalize.ts`), so the cache holds the `BoardState` of Section 5.4.2 —
 * the shape Section 5.4.3's optimistic updates splice — and every selector below is one map
 * lookup with a stable `select`, which lets TanStack's structural sharing skip the re-render
 * when a slice has not changed (Section 5.11).
 *
 * `refetchOnWindowFocus` and `refetchInterval: 30000` are the pre-realtime freshness mechanism
 * of the M2 checklist; `useBoardEvents` takes over as the primary signal in M4b.
 *
 * Everything that addresses `['board', boardId]` lives here: the key, the query, the selectors
 * and the two writes both mutation modules make into it — `invalidateBoard` and `mergeCardRow`.
 * `hooks/useBoardMutations.ts` and `hooks/useCardMutations.ts` had a copy of each.
 */
import { useCallback } from 'react';
import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { getBoard } from '@/api/boards';
import type { CardSummary, Mutated } from '@/api/types';
import {
  applyCardRow,
  isId,
  selectActiveCardCount,
  selectBoardMeta,
  selectCard,
  selectCards,
  selectLabels,
  selectList,
  selectListOrder,
  selectMatchedCardCount,
  selectMembers,
  setBoardVersion,
  type BoardMeta,
  type BoardState,
  type CardRow,
  type Id,
  type LabelRow,
  type ListRow,
  type MemberRow,
} from '@/lib/boardState';
import { normalizeBoard } from '@/lib/normalize';

/** The one key the whole board page shares (Section 5.4.1). */
export function boardKey(boardId: number): readonly ['board', number] {
  return ['board', boardId] as const;
}

/** Section 5.4.1: `staleTime: 30s`, `refetchInterval: 30000`, refetch on window focus. */
const STALE_MS = 30_000;
const REFETCH_MS = 30_000;

async function fetchBoardState(boardId: number): Promise<BoardState> {
  return normalizeBoard(await getBoard(boardId));
}

/** The one set of options behind every hook below, so all of them share a cache entry. */
function boardQuery(boardId: number) {
  return {
    queryKey: boardKey(boardId),
    queryFn: () => fetchBoardState(boardId),
    enabled: isId(boardId),
    staleTime: STALE_MS,
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
  };
}

function useBoardSelector<T>(
  boardId: number,
  select: (state: BoardState) => T,
): UseQueryResult<T, Error> {
  return useQuery({ ...boardQuery(boardId), select });
}

/** The whole board document. `BoardPage` reads it for its loading, error and closed states. */
export function useBoardState(boardId: number): UseQueryResult<BoardState, Error> {
  return useQuery(boardQuery(boardId));
}

/** The board row behind `BoardHeader`: name, background, role, star and closed flag. */
export function useBoardMeta(boardId: number): UseQueryResult<BoardMeta, Error> {
  return useBoardSelector(boardId, selectBoardMeta);
}

/** The active list ids, left to right — what `BoardCanvas` maps over. */
export function useListOrder(boardId: number): UseQueryResult<Id[], Error> {
  return useBoardSelector(boardId, selectListOrder);
}

export function useList(boardId: number, listId: Id): UseQueryResult<ListRow | undefined, Error> {
  const select = useCallback((state: BoardState) => selectList(state, listId), [listId]);
  return useBoardSelector(boardId, select);
}

/** One list's active cards in `<Draggable>` order — what `CardList` maps over. */
export function useListCards(boardId: number, listId: Id): UseQueryResult<CardRow[], Error> {
  const select = useCallback((state: BoardState) => selectCards(state, listId), [listId]);
  return useBoardSelector(boardId, select);
}

/** One card. `CardTile` subscribes to this alone, so one card change re-renders one tile. */
export function useCard(boardId: number, cardId: Id): UseQueryResult<CardRow | undefined, Error> {
  const select = useCallback((state: BoardState) => selectCard(state, cardId), [cardId]);
  return useBoardSelector(boardId, select);
}

/**
 * The list header's "matched/total" count (Section 2.4.2), and `undefined` while `matches` is
 * `null` because no filter is active. `ListColumn` reads this instead of the rows: the answer is
 * a number, so an edit that leaves the count alone never re-renders the column (Section 5.11).
 */
export function useMatchedCardCount(
  boardId: number,
  listId: Id,
  matches: ((card: CardRow) => boolean) | null,
): UseQueryResult<number | undefined, Error> {
  const select = useCallback(
    (state: BoardState) => selectMatchedCardCount(state, listId, matches),
    [listId, matches],
  );
  return useBoardSelector(boardId, select);
}

/** What `CardComposer` clamps `^N` against (Section 2.4.4). */
export function useActiveCardCount(boardId: number, listId: Id): UseQueryResult<number, Error> {
  const select = useCallback((state: BoardState) => selectActiveCardCount(state, listId), [listId]);
  return useBoardSelector(boardId, select);
}

/** The board's labels in `position` order: label chips and the composer's `#` tokens. */
export function useLabels(boardId: number): UseQueryResult<LabelRow[], Error> {
  return useBoardSelector(boardId, selectLabels);
}

/** The board's members: header avatars, tile avatars and the composer's `@` tokens. */
export function useMembers(boardId: number): UseQueryResult<MemberRow[], Error> {
  return useBoardSelector(boardId, selectMembers);
}

// ------------------------------------------------------------------ the writes into this entry

/**
 * Refetch the whole board. The bulk operations and every 204 delete answer without a
 * `board_version`, so they cannot be merged and settle with this instead (Section 5.4.3).
 */
export function invalidateBoard(queryClient: QueryClient, boardId: number): void {
  void queryClient.invalidateQueries({ queryKey: boardKey(boardId) });
}

/** Writes the `CardSummary` of a `Mutated<T>` response into the cache, plus its version. */
export function mergeCardRow(
  state: BoardState,
  { item, board_version }: Mutated<CardSummary>,
): BoardState {
  return setBoardVersion(applyCardRow(state, item), board_version);
}
