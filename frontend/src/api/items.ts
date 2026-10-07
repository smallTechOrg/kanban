/**
 * A card's items: every endpoint `ItemsSection` calls (Section 4.6).
 *
 * The reorder endpoint sends the single move body of Section 4.9 — the required 0-based `index`
 * plus the neighbour ids `onDragEnd` adds — and writes back the `position` and the `positions`
 * map the server returns. No function here computes a position.
 *
 * `POST /api/cards/{card_id}/items` has two response shapes, so it has two callers: `createItem`
 * for the one item the composer adds and `createItems` for the "Add N items" answer to a
 * multi-line paste, which the server splits into one row per non-empty line.
 */
import { api } from './client';
import type { CardItem, CardItemPatched, ItemsCreated, MoveResult, Mutated } from './types';
import type { MoveInput } from './lists';

/** `POST /api/cards/{card_id}/items`; an absent `index` appends (Section 4.6). */
export interface CreateItemInput {
  name: string;
  index?: number;
}

/**
 * `PATCH /api/card-items/{item_id}` (Section 4.6). `due_at: null` removes the item's due date;
 * `name` and `is_checked` are never nullable.
 */
export interface UpdateItemInput {
  name?: string;
  is_checked?: boolean;
  due_at?: string | null;
}

/** `POST /api/cards/{card_id}/items` — 201 with the one item the composer added. */
export function createItem(cardId: number, input: CreateItemInput): Promise<Mutated<CardItem>> {
  return api.post<Mutated<CardItem>>(`/cards/${cardId}/items`, input);
}

/** The same endpoint with `split_lines: true`: one item per non-empty line, in order. */
export function createItems(cardId: number, input: CreateItemInput): Promise<ItemsCreated> {
  return api.post<ItemsCreated>(`/cards/${cardId}/items`, { ...input, split_lines: true });
}

/**
 * `PATCH /api/card-items/{item_id}` — tick, rename or date. The response carries the card's
 * recomputed `badges`, so the tile's `done/total` is patched from this round trip.
 */
export function updateItem(
  itemId: number,
  input: UpdateItemInput,
): Promise<Mutated<CardItemPatched>> {
  return api.patch<Mutated<CardItemPatched>>(`/card-items/${itemId}`, input);
}

/** `DELETE /api/card-items/{item_id}` — 204. */
export function deleteItem(itemId: number): Promise<void> {
  return api.del(`/card-items/${itemId}`);
}

/** `POST /api/card-items/{item_id}/move` — a reorder inside the item's own card (Section 4.6). */
export function moveItem(itemId: number, input: MoveInput): Promise<MoveResult<CardItem>> {
  return api.post<MoveResult<CardItem>>(`/card-items/${itemId}/move`, input);
}
