/**
 * The destination a card can be moved or copied to: the boards I can pick, and the chosen
 * board's lists with their active card counts (Sections 2.6.5 and 4.4).
 *
 * `['lists', boardId]` is the key Section 5.4.1 gives `GET /api/boards/{board_id}/lists`, and
 * this module is the only place it is declared and queried — the TopNav "Create card" form
 * (Section 2.1.1) reads it through `useBoardLists` rather than keying it a second time. For the
 * Move and Copy popovers the open board is not fetched at all: its whole
 * payload is already in `['board', boardId]`, so the current board's lists and counts are
 * selected from that cache and only *another* board costs a request (Section 2.6.5).
 */
import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { listLists } from '@/api/lists';
import type { BoardSummary, ListWithCount } from '@/api/types';
import { isId, type Id } from '@/lib/boardState';
import { useBoardMeta, useBoardState } from './useBoardData';
import { useBoards } from './useBoards';

/** The lists key of Section 5.4.1. */
function boardListsKey(boardId: number): readonly ['lists', number] {
  return ['lists', boardId] as const;
}

/** The select is re-read whenever the Move list sub-view opens, never while it is open. */
const LISTS_STALE_MS = 10_000;

/** One row of the List select: everything the List and Position selects need, nothing else. */
export interface DestinationList {
  id: Id;
  name: string;
  /** Active cards in the list, which is what the Position select counts slots from. */
  card_count: number;
}

export interface DestinationLists {
  lists: DestinationList[];
  /** True while the rows for the chosen board are still on their way. */
  isPending: boolean;
}

/** One row of the Board select: the id it sends and the name it shows. */
export interface DestinationBoard {
  id: Id;
  name: string;
}

/** My open boards, in the alphabetical order `GET /api/boards` returns `all[]` in (Section 4.3). */
function useOpenBoards(): BoardSummary[] {
  const { data } = useBoards();
  return useMemo(() => (data?.all ?? []).filter((board) => !board.is_closed), [data]);
}

/**
 * The rows the Board select offers, with the board the row lives on always among them.
 *
 * `['boards']` is not loaded on a direct card link, so the current board is prepended from
 * `['board', boardId]` until its real row arrives — otherwise the select of a deep-linked card
 * would open on a board that is not in its own options. Both Board selects of Section 2.6.5 and
 * the Move-list sub-view of Section 2.4.3 need that, so it is decided once.
 */
export function useDestinationBoardOptions(boardId: number): DestinationBoard[] {
  const boards = useOpenBoards();
  const currentName = useBoardMeta(boardId).data?.name ?? '';

  return useMemo(() => {
    const rows = boards.map((board) => ({ id: board.id, name: board.name }));
    return rows.some((board) => board.id === boardId)
      ? rows
      : [{ id: boardId, name: currentName }, ...rows];
  }, [boards, boardId, currentName]);
}

/**
 * `GET /api/boards/{board_id}/lists` — active lists with their active card counts.
 *
 * Exported for the TopNav "Create card" form (Section 2.1.1), whose List select is fed by this
 * key for *every* board: the nav has no open board to read a cached payload from, so it asks the
 * endpoint the plan names rather than reaching into `['board', boardId]`.
 */
export function useBoardLists(
  boardId: number,
  enabled = true,
): UseQueryResult<ListWithCount[], Error> {
  return useQuery({
    queryKey: boardListsKey(boardId),
    queryFn: () => listLists(boardId),
    enabled: enabled && isId(boardId),
    staleTime: LISTS_STALE_MS,
    select: (data) => data.items,
  });
}

/**
 * The chosen board's lists: from the board cache when that board is the open one, from
 * `['lists', boardId]` otherwise. Both shapes are reduced to `DestinationList`, so the selects
 * never branch on where their rows came from.
 */
export function useDestinationLists(boardId: number, targetBoardId: number): DestinationLists {
  const isCurrent = targetBoardId === boardId;
  const { data: state } = useBoardState(boardId);
  const { data: fetched, isPending: isFetching } = useBoardLists(targetBoardId, !isCurrent);

  return useMemo(() => {
    if (isCurrent) {
      if (state === undefined) return { lists: [], isPending: true };
      return {
        lists: state.listOrder.map((id) => ({
          id,
          name: state.lists[id]?.name ?? '',
          card_count: state.cardOrder[id]?.length ?? 0,
        })),
        isPending: false,
      };
    }
    return {
      lists: (fetched ?? []).map(({ id, name, card_count }) => ({ id, name, card_count })),
      isPending: isFetching,
    };
  }, [isCurrent, state, fetched, isFetching]);
}
