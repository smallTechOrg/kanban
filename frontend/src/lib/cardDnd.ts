/**
 * The pure half of the card modal's drag-and-drop: the ids its droppable carries and the move
 * one drop describes (Sections 2.6.3, 4.6 and 5.5).
 *
 * The modal has its own `DragDropContext` with a single `items-{cardId}` / `ITEM` droppable: a
 * card's items hang off the card itself, so there is no second container to move between and a
 * drop is always a reorder.
 *
 * As on the board (`lib/boardDnd.ts`), the whole decision lives here as one function over plain
 * data and `CardDetailModal` only calls it, and no position is computed: the outcome carries the
 * drop's `index` plus the two neighbour ids of Section 4.9 and the server answers with the
 * authoritative `position`.
 */
import { dropDestination, parsePrefixed, type DragDrop } from './boardDnd';
import type { Id } from './boardState';

/** The one `Droppable` type. A `Draggable` inherits the type of its parent `Droppable`. */
export const ITEM_DRAG_TYPE = 'ITEM';

const ITEMS_PREFIX = 'items-';
const ITEM_PREFIX = 'item-';

/** `items-{cardId}`: the one vertical droppable the card's items are reordered in (2.6.3). */
export function itemsDropId(cardId: Id): string {
  return `${ITEMS_PREFIX}${cardId}`;
}

/** `item-{id}`. An optimistic item's id is negative until the create response swaps it. */
export function itemDragId(itemId: Id): string {
  return `${ITEM_PREFIX}${itemId}`;
}

export function parseItemId(value: string): Id | null {
  return parsePrefixed(value, ITEM_PREFIX);
}

/** The body of `POST /api/card-items/{item_id}/move` (Sections 4.6 and 4.9). */
export interface ItemMove {
  itemId: Id;
  index: number;
  prevId: Id | null;
  nextId: Id | null;
}

export type CardDropOutcome = { kind: 'item'; item: ItemMove } | { kind: 'none' };

const NO_MOVE: CardDropOutcome = { kind: 'none' };

/** The rows the card shows: all of them, or only the unchecked ones (Section 2.6.3). */
export function visibleItems<T extends { is_checked: boolean }>(
  items: readonly T[],
  hideChecked: boolean,
): readonly T[] {
  return hideChecked ? items.filter((item) => !item.is_checked) : items;
}

/** The ids of a card's items in order. Pass `hideChecked` to get the rendered order. */
export function itemOrder(
  items: readonly { id: Id; is_checked: boolean }[],
  hideChecked = false,
): readonly Id[] {
  return visibleItems(items, hideChecked).map((item) => item.id);
}

/**
 * Where a drop lands, in both of the forms the move needs.
 *
 * `destination.index` counts the rows the user actually dropped between, so the two neighbour
 * ids — which decide the slot server-side, taking precedence over `index` exactly as
 * `place_in_container` does (Section 4.9) — are read from the rendered order with the dragged row
 * removed. The `index` sent alongside them is the same slot over the *full* order, because that
 * is what the optimistic reducer in `useCardMutations` splices into, and with "Hide checked
 * items" on the two are not the same number.
 */
function landing(
  rendered: readonly Id[],
  full: readonly Id[],
  itemId: Id,
  index: number,
): { index: number; prevId: Id | null; nextId: Id | null } {
  const shown = rendered.filter((id) => id !== itemId);
  const all = full.filter((id) => id !== itemId);
  const nextId = shown[index] ?? null;
  const at = nextId === null ? -1 : all.indexOf(nextId);
  return { index: at < 0 ? all.length : at, prevId: shown[index - 1] ?? null, nextId };
}

/**
 * What one drop inside the modal should send, or `none` when it should send nothing: a drag
 * cancelled outside every droppable, a drop back into the slot it came from, or an id that is
 * not one of ours.
 *
 * `rendered` is the order the section puts on screen and `full` the order the card cache holds;
 * they are the same array unless "Hide checked items" is on.
 */
export function cardMoveFromDrop(
  drop: DragDrop,
  rendered: readonly Id[],
  full: readonly Id[] = rendered,
): CardDropOutcome {
  const destination = dropDestination(drop);
  if (destination === null) return NO_MOVE;

  const itemId = parseItemId(drop.draggableId);
  if (itemId === null) return NO_MOVE;
  return { kind: 'item', item: { itemId, ...landing(rendered, full, itemId, destination.index) } };
}
