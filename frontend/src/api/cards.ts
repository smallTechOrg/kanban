/**
 * The card endpoints of Sections 4.4 and 4.5: the composer's create, the scalar `PATCH`, the
 * drag-and-drop move contract, archive/restore and delete (Section 3.7).
 *
 * `moveCard` is the one endpoint drag-and-drop calls. It sends the `index` the drop produced
 * plus the neighbour ids read from the destination order *with the dragged card removed*
 * (Section 5.5) and returns `MoveResult`, whose `position`, `positions` map and `board_version`
 * the hook writes into the cache. The client never computes a position.
 */
import { api } from './client';
import type {
  CardDetail,
  CardsCreated,
  CardSummary,
  DueReminderMinutes,
  MoveResult,
  Mutated,
} from './types';
import type { MoveInput } from './lists';

/** Where a new card lands: a 0-based slot over the list's active cards, or `top` / `bottom`. */
export type CardIndex = number | 'top' | 'bottom';

/**
 * `POST /api/lists/{list_id}/cards` (Section 4.4). `client_id` is the `tmp_` id the optimistic
 * tile was inserted with; the server stores it and echoes it in every later `CardSummary` of
 * that card. `split_lines` turns a multi-line paste into one card per non-empty line.
 */
export interface CreateCardInput {
  title: string;
  index?: CardIndex;
  client_id?: string;
  label_ids?: number[];
  split_lines?: boolean;
}

/**
 * `PATCH /api/cards/{card_id}` — every scalar field of a card (Section 4.5). Moving and
 * archiving have their own routes, and `is_archived` is never patchable (Section 3.7).
 *
 * An absent field is untouched. Only the three nullable columns accept an explicit `null`, and
 * they are exactly what the `DatesPopover` "Remove" button sends: `{start_at: null, due_at:
 * null, due_reminder_minutes: null}`. `start_at` / `due_at` are ISO-8601 UTC strings ending in
 * `Z`, converted from browser-local time before they are sent (Section 2.6.5).
 */
export interface UpdateCardInput {
  title?: string;
  description?: string;
  start_at?: string | null;
  due_at?: string | null;
  due_complete?: boolean;
  due_reminder_minutes?: DueReminderMinutes | null;
}

/**
 * The move body of Section 4.9 plus the destination list, which is always a list of the card's
 * own board: a card never changes board (only a whole list does, Section 3.6).
 */
export interface MoveCardInput extends MoveInput {
  to_list_id: number;
}

/** `POST /api/lists/{list_id}/cards` — 201 with the one card the composer added. */
export function createCard(listId: number, input: CreateCardInput): Promise<Mutated<CardSummary>> {
  return api.post<Mutated<CardSummary>>(`/lists/${listId}/cards`, input);
}

/** The same endpoint with `split_lines: true`: one card per non-empty line, in order. */
export function createCards(listId: number, input: CreateCardInput): Promise<CardsCreated> {
  return api.post<CardsCreated>(`/lists/${listId}/cards`, { ...input, split_lines: true });
}

/**
 * `GET /api/cards/{card_id}` — the whole document the modal renders: the summary plus the
 * description, the reminder offset, the board and list names and the card's items
 * (Section 4.5). An archived card is returned too; the modal shows the banner.
 */
export function getCardDetail(cardId: number): Promise<CardDetail> {
  return api.get<CardDetail>(`/cards/${cardId}`);
}

/** `PATCH /api/cards/{card_id}` — the inline title edit and every card-modal field. */
export function updateCard(cardId: number, input: UpdateCardInput): Promise<Mutated<CardSummary>> {
  return api.patch<Mutated<CardSummary>>(`/cards/${cardId}`, input);
}

/** `POST /api/cards/{card_id}/move` — the drag-and-drop endpoint (Sections 4.9 and 5.5). */
export function moveCard(cardId: number, input: MoveCardInput): Promise<MoveResult<CardSummary>> {
  return api.post<MoveResult<CardSummary>>(`/cards/${cardId}/move`, input);
}

/** `POST /api/cards/{card_id}/archive` — keeps `position`, so Undo restores the slot. */
export function archiveCard(cardId: number): Promise<Mutated<CardSummary>> {
  return api.post<Mutated<CardSummary>>(`/cards/${cardId}/archive`);
}

/**
 * `POST /api/cards/{card_id}/unarchive` — back into its own slot; 409 `conflict` when the
 * board has no active list to receive it (Section 4.5).
 */
export function unarchiveCard(cardId: number): Promise<Mutated<CardSummary>> {
  return api.post<Mutated<CardSummary>>(`/cards/${cardId}/unarchive`);
}

/**
 * `DELETE /api/cards/{card_id}` — 204 (Sections 3.7 and 6.8). The one destructive action a card
 * offers, so it does not require the card to be archived first. There is no undo: the row and
 * its items go, which is why the modal confirms before calling it.
 */
export function deleteCard(cardId: number): Promise<void> {
  return api.del(`/cards/${cardId}`);
}
