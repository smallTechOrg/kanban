/**
 * Card comments and the activity feed behind them (Sections 4.5, 4.6 and 2.6.3).
 *
 * The feed is one paginated view over `activities`, not two id spaces: every comment has a
 * `comment.added` row carrying `data.comment_id`, so `activities.id` is the only cursor and
 * `getFeed` pages with `before=<activities.id>`. `details` is always sent explicitly from
 * `uiStore.activityDetails` (the UI default is hidden) rather than relying on the server's
 * default of 1 (Section 4.5).
 */
import { api } from './client';
import type { CardFeed, Comment, Mutated } from './types';

/** Section 4.5: one page of the feed is 30 rows, newest first. */
export const FEED_PAGE_SIZE = 30;

/** `GET /api/cards/{card_id}/feed` query (Section 4.5). */
export interface FeedQuery {
  /** An `activities.id` to page before; absent is the newest page. */
  before?: number;
  limit?: number;
  /** `true` renders every activity type; `false` is "Hide details" — comments only. */
  details: boolean;
}

/** `POST /api/cards/{card_id}/comments` — 201; observers may comment (Section 4.6). */
export function createComment(cardId: number, body: string): Promise<Mutated<Comment>> {
  return api.post<Mutated<Comment>>(`/cards/${cardId}/comments`, { body });
}

/** `PATCH /api/comments/{comment_id}` — the author's own edit; 403 for anybody else's. */
export function updateComment(commentId: number, body: string): Promise<Mutated<Comment>> {
  return api.patch<Mutated<Comment>>(`/comments/${commentId}`, { body });
}

/** `DELETE /api/comments/{comment_id}` — 204; the author, or any board admin. */
export function deleteComment(commentId: number): Promise<void> {
  return api.del(`/comments/${commentId}`);
}

/** `GET /api/cards/{card_id}/feed?before=&limit=&details=` — one page, newest first. */
export function getFeed(cardId: number, query: FeedQuery): Promise<CardFeed> {
  const params = new URLSearchParams({
    limit: String(query.limit ?? FEED_PAGE_SIZE),
    details: query.details ? '1' : '0',
  });
  if (query.before !== undefined) params.set('before', String(query.before));
  return api.get<CardFeed>(`/cards/${cardId}/feed?${params.toString()}`);
}
