/**
 * `['activity', boardId]` — the infinite feed of `BoardMenuDrawer` (Sections 5.4.1 and 2.3.4).
 *
 * The board feed is the card feed's sibling: one paginated view over `activities`, newest first,
 * cursored by `activities.id`, with `next_before` going `null` once the page was not full — which
 * is how "Load more" stops. It differs in what it renders, not in how it pages: every row is a
 * sentence from `lib/activity.ts` (no comment bubbles), so the items are plain `Activity` rows and
 * there is no `details` flag to key on, unlike `['feed', cardId, details]` in `hooks/useCard.ts`.
 *
 * The drawer panel mounts this only while it is open, and the `enabled` flag lets a caller that
 * keeps the panel mounted hold the request back until it is shown.
 */
import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { getBoardActivity } from '@/api/activity';
import type { ActivityPage } from '@/api/types';
import { isId } from '@/lib/boardState';

/** The key of Section 5.4.1. */
export function activityKey(boardId: number): readonly ['activity', number] {
  return ['activity', boardId] as const;
}

/** The cursor: an `activities.id`, or `undefined` for the newest page. */
export type ActivityPageParam = number | undefined;

/** What `['activity', boardId]` holds. */
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
