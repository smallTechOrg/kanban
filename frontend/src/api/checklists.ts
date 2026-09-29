/**
 * Checklists and checklist items: every endpoint `ChecklistSection` calls (Section 4.6).
 *
 * The two reorder endpoints send the single move body of Section 4.9 — the required 0-based
 * `index` plus the neighbour ids `onDragEnd` adds — and write back the `position` and the
 * `positions` map the server returns. No function here computes a position.
 *
 * `POST /api/checklists/{checklist_id}/items` has two response shapes, so it has two callers:
 * `createItem` for the one item the composer adds and `createItems` for the "Add N items"
 * answer to a multi-line paste, which the server splits into one row per non-empty line.
 */
import { api } from './client';
import type {
  BoardChecklistList,
  CardSummary,
  Checklist,
  ChecklistItem,
  ChecklistItemPatched,
  ItemsCreated,
  MoveResult,
  Mutated,
} from './types';
import type { MoveInput } from './lists';

/**
 * `POST /api/cards/{card_id}/checklists` (Section 2.6.5). An absent `name` is the server's
 * "Checklist" default; `copy_from_checklist_id` is the "Copy items from…" select, whose items
 * are copied unchecked.
 */
export interface CreateChecklistInput {
  name?: string;
  copy_from_checklist_id?: number;
}

/** `POST /api/checklists/{checklist_id}/items`; an absent `index` appends (Section 4.6). */
export interface CreateItemInput {
  name: string;
  index?: number;
}

/**
 * `PATCH /api/checklist-items/{item_id}` (Section 4.6). `due_at: null` removes the item's due
 * date; `name` and `is_checked` are never nullable.
 */
export interface UpdateItemInput {
  name?: string;
  is_checked?: boolean;
  due_at?: string | null;
}

/** The move body of Section 4.9 plus the destination checklist, which is on the same card. */
export interface MoveItemInput extends MoveInput {
  to_checklist_id: number;
}

/** `POST /api/checklist-items/{item_id}/convert`; an absent `index` appends (Section 4.6). */
export interface ConvertItemInput {
  index?: number | 'bottom';
}

/**
 * `GET /api/boards/{board_id}/checklists` — every checklist on the board whose card is visible,
 * ordered by card title then checklist `position`, for the "Copy items from…" select of
 * `ChecklistPopover` (query key `['checklists', boardId]`, Section 5.4.1).
 */
export function listBoardChecklists(boardId: number): Promise<BoardChecklistList> {
  return api.get<BoardChecklistList>(`/boards/${boardId}/checklists`);
}

/** `POST /api/cards/{card_id}/checklists` — 201 with the checklist and its copied items. */
export function createChecklist(
  cardId: number,
  input: CreateChecklistInput = {},
): Promise<Mutated<Checklist>> {
  return api.post<Mutated<Checklist>>(`/cards/${cardId}/checklists`, input);
}

/** `PATCH /api/checklists/{checklist_id}` — the inline rename on the section header. */
export function renameChecklist(checklistId: number, name: string): Promise<Mutated<Checklist>> {
  return api.patch<Mutated<Checklist>>(`/checklists/${checklistId}`, { name });
}

/** `DELETE /api/checklists/{checklist_id}` — 204; a checklist has no archive state. */
export function deleteChecklist(checklistId: number): Promise<void> {
  return api.del(`/checklists/${checklistId}`);
}

/** `POST /api/checklists/{checklist_id}/move` — the `CHECKLIST` drag of the modal (2.6.3). */
export function moveChecklist(
  checklistId: number,
  input: MoveInput,
): Promise<MoveResult<Checklist>> {
  return api.post<MoveResult<Checklist>>(`/checklists/${checklistId}/move`, input);
}

/** `POST /api/checklists/{checklist_id}/items` — 201 with the one item the composer added. */
export function createItem(
  checklistId: number,
  input: CreateItemInput,
): Promise<Mutated<ChecklistItem>> {
  return api.post<Mutated<ChecklistItem>>(`/checklists/${checklistId}/items`, input);
}

/** The same endpoint with `split_lines: true`: one item per non-empty line, in order. */
export function createItems(checklistId: number, input: CreateItemInput): Promise<ItemsCreated> {
  return api.post<ItemsCreated>(`/checklists/${checklistId}/items`, {
    ...input,
    split_lines: true,
  });
}

/**
 * `PATCH /api/checklist-items/{item_id}` — tick, rename, date or assign. The response carries
 * the card's recomputed `badges`, so the tile's `done/total` is patched from this round trip.
 */
export function updateItem(
  itemId: number,
  input: UpdateItemInput,
): Promise<Mutated<ChecklistItemPatched>> {
  return api.patch<Mutated<ChecklistItemPatched>>(`/checklist-items/${itemId}`, input);
}

/** `DELETE /api/checklist-items/{item_id}` — 204. */
export function deleteItem(itemId: number): Promise<void> {
  return api.del(`/checklist-items/${itemId}`);
}

/** `POST /api/checklist-items/{item_id}/move` — within or across the card's checklists. */
export function moveItem(itemId: number, input: MoveItemInput): Promise<MoveResult<ChecklistItem>> {
  return api.post<MoveResult<ChecklistItem>>(`/checklist-items/${itemId}/move`, input);
}

/**
 * `POST /api/checklist-items/{item_id}/convert` — "Convert to card": a new card in the item's
 * own list, titled with the item text, and the item is gone. 201 with the new `CardSummary`.
 */
export function convertItem(
  itemId: number,
  input: ConvertItemInput = {},
): Promise<Mutated<CardSummary>> {
  return api.post<Mutated<CardSummary>>(`/checklist-items/${itemId}/convert`, input);
}
