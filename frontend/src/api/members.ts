/**
 * The two per-card association endpoints of Section 4.5 that are not labels: who is assigned to
 * a card, and whether the caller watches it.
 *
 * They are one module because they are one row shape each and both are addressed by the card,
 * not by a child id: `MembersPopover`, the sidebar's "Join" button and the `Space` shortcut all
 * send the same `PUT` / `DELETE /api/cards/{card_id}/members/{user_id}`, and the "Watch" tiles
 * of the quick-badges row and the sidebar both send `PUT` / `DELETE
 * /api/cards/{card_id}/watch`.
 *
 * Both verbs answer with a document rather than 204 — the whole `member_ids` array, or the new
 * `is_watching` — so both deletes go through `api.delJson` (Section 4.5).
 *
 * Watching is per-user state: no `board_version`, no activity row and no event, because it runs
 * outside `write_tx` (`user_write`, Section 4.1). Assigning is board state and carries the
 * version like every other mutation.
 */
import { api } from './client';
import type { CardMembers, WatchState } from './types';

/**
 * `PUT /api/cards/{card_id}/members/{user_id}` — 400 when the user is not a board member, so
 * the popover only ever offers rows from the board cache.
 */
export function assignMember(cardId: number, userId: number): Promise<CardMembers> {
  return api.put<CardMembers>(`/cards/${cardId}/members/${userId}`);
}

/** `DELETE /api/cards/{card_id}/members/{user_id}` — 200 with the remaining `member_ids`. */
export function unassignMember(cardId: number, userId: number): Promise<CardMembers> {
  return api.delJson<CardMembers>(`/cards/${cardId}/members/${userId}`);
}

/** `PUT /api/cards/{card_id}/watch` — an upsert, so it is idempotent; observers may watch. */
export function watchCard(cardId: number): Promise<WatchState> {
  return api.put<WatchState>(`/cards/${cardId}/watch`);
}

/** `DELETE /api/cards/{card_id}/watch` — 200 with the constant `{is_watching: false}`. */
export function unwatchCard(cardId: number): Promise<WatchState> {
  return api.delJson<WatchState>(`/cards/${cardId}/watch`);
}
