/**
 * `GET /api/boards/{board_id}/activity` — the board feed of the menu drawer (Sections 4.3, 2.3.4).
 *
 * One paginated view over `activities`, newest first, cursored by `activities.id` exactly as the
 * card feed of `api/comments.ts` is: `next_before` is the id to page before and `null` once the
 * page was not full, which is what stops the infinite scroll. The rows are `Activity` objects and
 * carry no sentence — `lib/activity.ts` renders those from `type` + `data`.
 */
import { api } from './client';
import type { ActivityPage } from './types';

/** Section 4.3: one page of the board feed is 50 rows. */
export const ACTIVITY_PAGE_SIZE = 50;

/** `GET /api/boards/{board_id}/activity` query (Section 4.3). */
export interface BoardActivityQuery {
  /** An `activities.id` to page before; absent is the newest page. */
  before?: number;
  limit?: number;
}

/** One page of the board's activity, newest first. */
export function getBoardActivity(
  boardId: number,
  query: BoardActivityQuery = {},
): Promise<ActivityPage> {
  const params = new URLSearchParams({ limit: String(query.limit ?? ACTIVITY_PAGE_SIZE) });
  if (query.before !== undefined) params.set('before', String(query.before));
  return api.get<ActivityPage>(`/boards/${boardId}/activity?${params.toString()}`);
}
