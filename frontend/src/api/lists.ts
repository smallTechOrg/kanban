/**
 * The list endpoints of Section 4.4: the column itself, its move contract and every bulk
 * operation of `ListMenuPopover` (Section 2.4.3).
 *
 * No function here computes a `position`. A move sends the 0-based `index` it read from the
 * drop, optionally with the neighbour ids that will surround the list afterwards, and writes
 * back the `position`, the `positions` map and the `board_version` the server returns
 * (Section 4.9).
 */
import { api } from './client';
import type {
  ArchiveAllCardsResult,
  ListColorKey,
  ListList,
  ListOut,
  MoveAllCardsResult,
  MoveResult,
  Mutated,
  PositionsResult,
  UnarchiveCardsResult,
} from './types';

/** `POST /api/boards/{board_id}/lists`; an absent `index` appends (Section 4.4). */
export interface CreateListInput {
  name: string;
  index?: number;
}

/** `PATCH /api/lists/{list_id}`: rename, recolour or both. `color: null` removes the colour. */
export interface UpdateListInput {
  name?: string;
  color?: ListColorKey | null;
}

/**
 * The single move body of Section 4.9. `index` is required and 0-based over the destination's
 * active siblings; `prev_id` / `next_id` are the ids that will surround the row *after* the
 * move and are sent by `onDragEnd` only, where they take precedence over `index`. `to_board_id`
 * hands the whole column and its cards to another board (Section 3.6) and is sent by the
 * Move-list sub-view of Section 2.4.3 only.
 */
export interface MoveInput {
  index: number;
  prev_id?: number | null;
  next_id?: number | null;
  to_board_id?: number;
}

/** `POST /api/lists/{list_id}/copy`; an absent `index` lands right after the source. */
export interface CopyListInput {
  name: string;
  index?: number;
}

/** The four orders "Sort by…" offers (Section 2.4.3); `due` sorts cards without a date last. */
export type SortListBy = 'created_desc' | 'created_asc' | 'title' | 'due';

/**
 * `GET /api/boards/{board_id}/lists` — the board's active columns, each with its count of
 * active cards (Section 4.4). The cheap source for the Board / List / Position selects when the
 * destination is a board other than the open one, whose payload the client does not hold.
 */
export function listLists(boardId: number): Promise<ListList> {
  return api.get<ListList>(`/boards/${boardId}/lists`);
}

/** `POST /api/boards/{board_id}/lists` — 201 with the new column. */
export function createList(boardId: number, input: CreateListInput): Promise<Mutated<ListOut>> {
  return api.post<Mutated<ListOut>>(`/boards/${boardId}/lists`, input);
}

/** `PATCH /api/lists/{list_id}` — inline rename and "Change list color". */
export function updateList(listId: number, input: UpdateListInput): Promise<Mutated<ListOut>> {
  return api.patch<Mutated<ListOut>>(`/lists/${listId}`, input);
}

/** `POST /api/lists/{list_id}/move` — the drag and the Move-list sub-view; the server positions. */
export function moveList(listId: number, input: MoveInput): Promise<MoveResult<ListOut>> {
  return api.post<MoveResult<ListOut>>(`/lists/${listId}/move`, input);
}

/** `POST /api/lists/{list_id}/copy` — a deep copy of the list and its active cards. */
export function copyList(listId: number, input: CopyListInput): Promise<Mutated<ListOut>> {
  return api.post<Mutated<ListOut>>(`/lists/${listId}/copy`, input);
}

/** `POST /api/lists/{list_id}/archive` — the cards stay attached and hidden with the list. */
export function archiveList(listId: number): Promise<Mutated<ListOut>> {
  return api.post<Mutated<ListOut>>(`/lists/${listId}/archive`);
}

/** `POST /api/lists/{list_id}/unarchive` — "Send to board", back in its old slot. */
export function unarchiveList(listId: number): Promise<Mutated<ListOut>> {
  return api.post<Mutated<ListOut>>(`/lists/${listId}/unarchive`);
}

/** `DELETE /api/lists/{list_id}` — 204, and 409 unless the list is archived (Section 3.7). */
export function deleteList(listId: number): Promise<void> {
  return api.del(`/lists/${listId}`);
}

/** `POST /api/lists/{list_id}/move-all-cards` — same board; appends in the current order. */
export function moveAllCards(listId: number, toListId: number): Promise<MoveAllCardsResult> {
  return api.post<MoveAllCardsResult>(`/lists/${listId}/move-all-cards`, { to_list_id: toListId });
}

/** `POST /api/lists/{list_id}/archive-all-cards` — `archived_ids` feeds the Undo toast. */
export function archiveAllCards(listId: number): Promise<ArchiveAllCardsResult> {
  return api.post<ArchiveAllCardsResult>(`/lists/${listId}/archive-all-cards`);
}

/** `POST /api/lists/{list_id}/unarchive-cards` — the Undo: 1-500 ids in one request. */
export function unarchiveCards(listId: number, cardIds: number[]): Promise<UnarchiveCardsResult> {
  return api.post<UnarchiveCardsResult>(`/lists/${listId}/unarchive-cards`, { card_ids: cardIds });
}

/** `POST /api/lists/{list_id}/sort` — rewrites the active cards' positions server-side. */
export function sortList(listId: number, by: SortListBy): Promise<PositionsResult> {
  return api.post<PositionsResult>(`/lists/${listId}/sort`, { by });
}
