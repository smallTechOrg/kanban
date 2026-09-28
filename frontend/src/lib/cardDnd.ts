/**
 * The pure half of the card modal's drag-and-drop: the ids its two droppables carry and the
 * move one drop describes (Sections 2.6.3, 4.6 and 5.5).
 *
 * The modal has its own `DragDropContext` with two nested droppable *types*, which is what keeps
 * checklists and items from ever mixing: the sections sit in one vertical
 * `checklists-{cardId}` / `CHECKLIST` droppable and each section's rows in a
 * `checklist-{id}` / `CHECKLIST_ITEM` droppable inside it. `@hello-pangea/dnd` only ever offers a
 * `Draggable` the droppables of its own type, so a lifted item cannot land between two sections
 * and a lifted section cannot land inside a checklist.
 *
 * As on the board (`lib/boardDnd.ts`), the whole decision lives here as one function over plain
 * data and `CardDetailModal` only calls it, and no position is computed: the outcome carries the
 * drop's `index` plus the two neighbour ids of Section 4.9 and the server answers with the
 * authoritative `position`.
 */
import { dropDestination, parsePrefixed, type DragDrop } from './boardDnd';
import type { Id } from './boardState';

/** `Droppable` types. A `Draggable` inherits the type of its parent `Droppable`. */
export const CHECKLIST_DRAG_TYPE = 'CHECKLIST';
export const CHECKLIST_ITEM_DRAG_TYPE = 'CHECKLIST_ITEM';

const CHECKLISTS_PREFIX = 'checklists-';
const CHECKLIST_PREFIX = 'checklist-';
const ITEM_PREFIX = 'item-';

/** `checklists-{cardId}`: the one vertical droppable the sections are reordered in (2.6.3). */
export function checklistsDropId(cardId: Id): string {
  return `${CHECKLISTS_PREFIX}${cardId}`;
}

/**
 * `checklist-{id}`: the id of a checklist's item droppable and of the section's own
 * `Draggable`, which may share one string because the library keeps droppables and draggables
 * in two registries (the same pairing `listDropId` relies on).
 */
export function checklistDropId(checklistId: Id): string {
  return `${CHECKLIST_PREFIX}${checklistId}`;
}

/** `item-{id}`. An optimistic item's id is negative until the create response swaps it. */
export function itemDragId(itemId: Id): string {
  return `${ITEM_PREFIX}${itemId}`;
}

export function parseChecklistId(value: string): Id | null {
  return parsePrefixed(value, CHECKLIST_PREFIX);
}

export function parseItemId(value: string): Id | null {
  return parsePrefixed(value, ITEM_PREFIX);
}

/** The body of `POST /api/checklists/{checklist_id}/move`: the index alone (Section 4.6). */
export interface ChecklistMove {
  checklistId: Id;
  index: number;
}

/** The body of `POST /api/checklist-items/{item_id}/move` (Sections 4.6 and 4.9). */
export interface ItemMove {
  itemId: Id;
  toChecklistId: Id;
  index: number;
  prevId: Id | null;
  nextId: Id | null;
}

export type CardDropOutcome =
  | { kind: 'checklist'; checklist: ChecklistMove }
  | { kind: 'item'; item: ItemMove }
  | { kind: 'none' };

/** `checklistId` -> item ids in order. One map of what is rendered, one of everything. */
export type ItemOrder = Readonly<Record<Id, readonly Id[]>>;

/** What the order helpers need of a card's checklists: `CardDetail.checklists` satisfies it. */
export interface ChecklistShape {
  id: Id;
  items: readonly { id: Id; is_checked: boolean }[];
}

const NO_MOVE: CardDropOutcome = { kind: 'none' };

/** The rows one checklist shows: all of them, or only the unchecked ones (Section 2.6.3). */
export function visibleItems<T extends { is_checked: boolean }>(
  items: readonly T[],
  hideChecked: boolean,
): readonly T[] {
  return hideChecked ? items.filter((item) => !item.is_checked) : items;
}

/**
 * The `ItemOrder` for one card. `hiddenChecklistIds` are the checklists with "Hide checked
 * items" on, whose checked rows are left out — pass none for the order the cache holds.
 */
export function itemOrder(
  checklists: readonly ChecklistShape[],
  hiddenChecklistIds: readonly Id[] = [],
): ItemOrder {
  const order: Record<Id, readonly Id[]> = {};
  for (const checklist of checklists) {
    const rows = visibleItems(checklist.items, hiddenChecklistIds.includes(checklist.id));
    order[checklist.id] = rows.map((item) => item.id);
  }
  return order;
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
 * `rendered` is the order the sections put on screen and `full` the order the card cache holds;
 * they are the same object when no checklist hides its checked items.
 */
export function cardMoveFromDrop(
  drop: DragDrop,
  rendered: ItemOrder,
  full: ItemOrder = rendered,
): CardDropOutcome {
  const destination = dropDestination(drop);
  if (destination === null) return NO_MOVE;

  if (drop.type === CHECKLIST_DRAG_TYPE) {
    const checklistId = parseChecklistId(drop.draggableId);
    if (checklistId === null) return NO_MOVE;
    return { kind: 'checklist', checklist: { checklistId, index: destination.index } };
  }

  const itemId = parseItemId(drop.draggableId);
  const toChecklistId = parseChecklistId(destination.droppableId);
  if (itemId === null || toChecklistId === null) return NO_MOVE;
  const place = landing(
    rendered[toChecklistId] ?? [],
    full[toChecklistId] ?? [],
    itemId,
    destination.index,
  );
  return { kind: 'item', item: { itemId, toChecklistId, ...place } };
}
