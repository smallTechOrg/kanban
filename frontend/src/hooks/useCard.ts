/**
 * The three queries the card detail modal reads (Section 5.4.1).
 *
 * `['card', cardId]` is the whole document `CardDetailModal` renders — the card plus its
 * description, dates, board and list names and checklists — so the modal opens on one request
 * instead of stitching the board payload together with four more. `['feed', cardId]` is the
 * `useInfiniteQuery` behind `ActivityFeed`, paged with `before=<activities.id>` over the
 * activities-driven feed with comments joined in. `['checklists', boardId]` backs the
 * "Copy items from…" select of `ChecklistPopover`.
 *
 * Unlike the board query these are not polled: `useBoardEvents` invalidates both card keys for
 * every event carrying this `card_id` in M4b (Section 5.4.3), and `hooks/useCardMutations.ts`
 * writes its own responses straight into the caches meanwhile.
 */
import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { getCardDetail } from '@/api/cards';
import { listBoardChecklists } from '@/api/checklists';
import { getFeed } from '@/api/comments';
import type { BoardChecklist, CardDetail, CardFeed } from '@/api/types';
import { isId } from '@/lib/boardState';

/** The detail key of Section 5.4.1; `useCardMutations` patches the same entry. */
export function cardKey(cardId: number): readonly ['card', number] {
  return ['card', cardId] as const;
}

/**
 * The feed key of Section 5.4.1. "Show details" changes what the server returns, so it is the
 * third element: `['feed', cardId]` stays the prefix every invalidation of Section 5.4.3
 * matches, while the two modes keep their own pages instead of overwriting each other.
 */
export function feedKey(cardId: number): readonly ['feed', number] {
  return ['feed', cardId] as const;
}

/** The "Copy items from…" rows of `ChecklistPopover` (Section 5.4.1). */
export function boardChecklistsKey(boardId: number): readonly ['checklists', number] {
  return ['checklists', boardId] as const;
}

/** The feed cursor: an `activities.id`, or `undefined` for the newest page. */
export type FeedPageParam = number | undefined;

/** What `['feed', cardId, details]` holds. `useCardMutations` patches it optimistically. */
export type FeedPages = InfiniteData<CardFeed, FeedPageParam>;

/** The board query's freshness window, shared so the modal and the tile agree (Section 5.4.1). */
const STALE_MS = 30_000;

/** The "Copy items from…" select is re-read whenever the popover opens (Section 5.4.1). */
const CHECKLISTS_STALE_MS = 10_000;

/**
 * `GET /api/cards/{card_id}` — the modal's whole document. An archived card is returned too, so
 * the modal can show the banner, and a card that has moved to another board answers with its new
 * `board_id`, which is what makes the URL replace itself (Section 2.6.1).
 */
export function useCardDetail(cardId: number): UseQueryResult<CardDetail, Error> {
  return useQuery({
    queryKey: cardKey(cardId),
    queryFn: () => getCardDetail(cardId),
    enabled: isId(cardId),
    staleTime: STALE_MS,
  });
}

/**
 * `GET /api/cards/{card_id}/feed?before=&limit=30&details=` — newest first, "Load more" at the
 * bottom. `details` comes from `uiStore.activityDetails` and is always sent explicitly, never
 * left to the server's default of 1 (Section 4.5).
 */
export function useCardFeed(
  cardId: number,
  details: boolean,
): UseInfiniteQueryResult<FeedPages, Error> {
  return useInfiniteQuery({
    queryKey: [...feedKey(cardId), details] as const,
    queryFn: ({ pageParam }) => getFeed(cardId, { before: pageParam, details }),
    initialPageParam: undefined as FeedPageParam,
    // `next_before` is null once the page was not full, which is how "Load more" stops.
    getNextPageParam: (lastPage: CardFeed) => lastPage.next_before ?? undefined,
    enabled: isId(cardId),
    staleTime: STALE_MS,
  });
}

/**
 * `GET /api/boards/{board_id}/checklists` — every checklist on the board whose card is visible,
 * as "Card title / Checklist name" rows with their item counts (Section 4.6).
 */
export function useBoardChecklists(
  boardId: number,
  enabled = true,
): UseQueryResult<BoardChecklist[], Error> {
  return useQuery({
    queryKey: boardChecklistsKey(boardId),
    queryFn: () => listBoardChecklists(boardId),
    enabled: enabled && isId(boardId),
    staleTime: CHECKLISTS_STALE_MS,
    select: (data) => data.items,
  });
}
