/**
 * `GET /api/boards/{board_id}/activity` — the activity feed, for both of its readers.
 *
 * One paginated view over `activities`, newest first, cursored by `activities.id`: `next_before`
 * is the id to page before and `null` once the page was not full, which is what stops the
 * infinite scroll. The board drawer (Section 2.3.4) reads the whole board and the card modal
 * (Section 2.6.3) reads the same page narrowed by `card_id`, because the two feeds differ by one
 * `WHERE` and nothing else — there is no card feed route of its own. The rows are `Activity`
 * objects and carry no sentence: `lib/activity.ts` renders those from `type` + `data`.
 */
import { api } from './client';
import type { ActivityPage } from './types';

/** Section 4.3: one page of the feed is 50 rows, for the board feed and the card's alike. */
export const ACTIVITY_PAGE_SIZE = 50;

/** `GET /api/boards/{board_id}/activity` query (Sections 4.3 and 4.5). */
export interface BoardActivityQuery {
  /** An `activities.id` to page before; absent is the newest page. */
  before?: number;
  /** Narrows the feed to one card's rows, which is what the card modal's feed is. */
  cardId?: number;
  limit?: number;
}

/** One page of the board's activity, newest first. */
export function getBoardActivity(
  boardId: number,
  query: BoardActivityQuery = {},
): Promise<ActivityPage> {
  const params = new URLSearchParams({ limit: String(query.limit ?? ACTIVITY_PAGE_SIZE) });
  if (query.before !== undefined) params.set('before', String(query.before));
  if (query.cardId !== undefined) params.set('card_id', String(query.cardId));
  return api.get<ActivityPage>(`/boards/${boardId}/activity?${params.toString()}`);
}
