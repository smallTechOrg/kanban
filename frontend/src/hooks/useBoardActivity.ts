/**
 * `['activity', boardId]` and `['activity', boardId, cardId]` — the two readers of the one
 * activity feed (Sections 5.4.1, 2.3.4 and 2.6.3).
 *
 * `GET /api/boards/{board_id}/activity` serves both: the drawer reads the whole board and the
 * card modal reads the same page narrowed by `card_id`, so the card's feed is the board key plus
 * one element rather than a key space of its own. That is what keeps `['activity', boardId]` a
 * *prefix* of every card's feed, so the one invalidation the mutation hooks make after a write
 * refreshes the drawer and whichever card is open, and nothing has to know which feeds exist.
 *
 * Both are paged the same way: newest first, cursored by `activities.id`, with `next_before`
 * going `null` once the page was not full — which is how "Load more" stops. Every row is a
 * sentence from `lib/activity.ts`.
 *
 * The drawer panel and the card modal mount these only while they are open, and the `enabled`
 * flag lets a caller that keeps its panel mounted hold the request back until it is shown.
 */
import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { getBoardActivity } from '@/api/activity';
import type { ActivityPage } from '@/api/types';
import { isId } from '@/lib/boardState';

/** The board feed's key, and the prefix of every card feed's (Section 5.4.1). */
export type ActivityKey = readonly ['activity', number] | readonly ['activity', number, number];

/** `['activity', boardId]`, or `['activity', boardId, cardId]` for one card's own feed. */
export function activityKey(boardId: number, cardId?: number): ActivityKey {
  return cardId === undefined
    ? (['activity', boardId] as const)
    : (['activity', boardId, cardId] as const);
}

/** The cursor: an `activities.id`, or `undefined` for the newest page. */
export type ActivityPageParam = number | undefined;

/** What an `['activity', …]` entry holds. */
export type ActivityPages = InfiniteData<ActivityPage, ActivityPageParam>;

/** The feed is a read of the same rows the board query covers, so it shares its window. */
const STALE_MS = 30_000;

/** `GET /api/boards/{board_id}/activity?before=&limit=50` — newest first, 50 rows a page. */
export function useBoardActivity(
  boardId: number,
  enabled = true,
): UseInfiniteQueryResult<ActivityPages, Error> {
  return useInfiniteQuery({
    queryKey: activityKey(boardId),
    queryFn: ({ pageParam }) => getBoardActivity(boardId, { before: pageParam }),
    initialPageParam: undefined as ActivityPageParam,
    getNextPageParam: (lastPage: ActivityPage) => lastPage.next_before ?? undefined,
    enabled: enabled && isId(boardId),
    staleTime: STALE_MS,
  });
}

/** The same feed narrowed to one card — what `ActivitySection` renders in the modal (2.6.3). */
export function useCardActivity(
  boardId: number,
  cardId: number,
  enabled = true,
): UseInfiniteQueryResult<ActivityPages, Error> {
  return useInfiniteQuery({
    queryKey: activityKey(boardId, cardId),
    queryFn: ({ pageParam }) => getBoardActivity(boardId, { before: pageParam, cardId }),
    initialPageParam: undefined as ActivityPageParam,
    getNextPageParam: (lastPage: ActivityPage) => lastPage.next_before ?? undefined,
    enabled: enabled && isId(boardId) && isId(cardId),
    staleTime: STALE_MS,
  });
}
