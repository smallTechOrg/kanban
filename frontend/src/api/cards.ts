/**
 * The card endpoints of Sections 4.4 and 4.5: the composer's create, the scalar `PATCH`, the
 * drag-and-drop move contract and the archive → delete state machine (Section 3.7).
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
  member_ids?: number[];
  split_lines?: boolean;
}

/**
 * `PATCH /api/cards/{card_id}` — every scalar field of a card (Section 4.5). Moving, covers and
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
  is_template?: boolean;
}

/**
 * The move body of Section 4.9 plus the destination list, and — only when the destination is
 * another board — that board's id (Section 4.5). `to_board_id` is what makes the server run one
 * `write_tx` across both boards: the card gets a new `short_id`, its labels are dropped and its
 * members and watchers are filtered to people who belong to the target board, so the response's
 * `board_version` is the **target** board's, not this one's.
 */
export interface MoveCardInput extends MoveInput {
  to_list_id: number;
  to_board_id?: number;
}

/**
 * What a copy keeps (Section 4.5). Every flag defaults to `false` server-side, so
 * `CopyCardPopover` sends all five explicitly — its own default is checked (2.6.5) — and a
 * cross-board copy never keeps labels or members whatever it sends.
 */
export interface CopyKeep {
  labels?: boolean;
  members?: boolean;
  checklists?: boolean;
  attachments?: boolean;
  comments?: boolean;
}

/**
 * `POST /api/cards/{card_id}/copy` (Section 4.5). `to_list_id` may belong to another board and
 * carries no `to_board_id` of its own: the server reads the board off the list. `is_template` is
 * how "Create from template" (2.5.5) makes an ordinary card out of a template one.
 */
export interface CopyCardInput {
  title: string;
  to_list_id: number;
  index: number;
  keep: CopyKeep;
  is_template?: boolean;
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
 * description, the reminder offset, the board and list names and the checklists with their
 * items (Section 4.5). An archived card is returned too; the modal shows the banner.
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

/**
 * `POST /api/cards/{card_id}/copy` — 201 with the new card. A deep copy: whatever `keep` asks
 * for is duplicated server-side, attachment files included, so the client has nothing to
 * assemble and reads the new rows back with the board.
 */
export function copyCard(cardId: number, input: CopyCardInput): Promise<Mutated<CardSummary>> {
  return api.post<Mutated<CardSummary>>(`/cards/${cardId}/copy`, input);
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
 * `DELETE /api/cards/{card_id}` — 204, and 409 `conflict` unless the card is already archived
 * (Sections 3.7 and 6.8). There is no undo: the row, its children and its attachment files go.
 */
export function deleteCard(cardId: number): Promise<void> {
  return api.del(`/cards/${cardId}`);
}
