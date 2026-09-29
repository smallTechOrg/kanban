/**
 * The pure half of drag-and-drop: the ids the droppables and draggables carry, and the move
 * one drop describes (Sections 2.7, 4.9 and 5.5).
 *
 * `onDragEnd` is where a kanban board is most easily got wrong, so the whole decision lives
 * here as one function over plain data and `BoardDndContext` only calls it. The rule it
 * encodes is the one Section 5.5 states twice: `destination.index` is an index over the
 * destination list **with the dragged card removed**, so the neighbour ids must be read from
 * that same post-removal order. Reading the pre-removal order on a downward move inside one
 * list would send the card itself as `prev_id`, which the server rejects (400) or, worse,
 * would silently undo the drop.
 *
 * The client never computes a `position`: the outcome carries `index` plus the two neighbour
 * ids, exactly the body of Section 4.9, and the server answers with the authoritative
 * `position`.
 */
import type { Id } from './boardState';

/** The one horizontal `Droppable` that holds the columns (Section 5.5). */
export const BOARD_DROPPABLE_ID = 'board';

/** `Droppable` types. A `Draggable` inherits the type of its parent `Droppable`. */
export const LIST_DRAG_TYPE = 'LIST';
export const CARD_DRAG_TYPE = 'CARD';

const LIST_PREFIX = 'list-';
const CARD_PREFIX = 'card-';

/**
 * `list-{id}`: the id of a list's card `Droppable` and of the list's own `Draggable`, which
 * may share one string because the library keeps droppables and draggables in two registries
 * (Section 5.5).
 */
export function listDropId(listId: Id): string {
  return `${LIST_PREFIX}${listId}`;
}

/** `card-{id}`. An optimistic card's id is negative until the create response swaps it. */
export function cardDragId(cardId: Id): string {
  return `${CARD_PREFIX}${cardId}`;
}

/**
 * The numeric id behind a prefixed drag id, or `null` when the string is not one of ours.
 *
 * Exported because `lib/cardDnd.ts` parses the modal's three prefixes with the same rule; the
 * `{prefix}-{id}` format is written down once, here.
 */
export function parsePrefixed(value: string, prefix: string): Id | null {
  if (!value.startsWith(prefix)) return null;
  const digits = value.slice(prefix.length);
  if (!/^-?\d+$/.test(digits)) return null;
  return Number(digits);
}

export function parseListId(value: string): Id | null {
  return parsePrefixed(value, LIST_PREFIX);
}

export function parseCardId(value: string): Id | null {
  return parsePrefixed(value, CARD_PREFIX);
}

/** One end of a drag, as `@hello-pangea/dnd` reports it. */
export interface DropLocation {
  droppableId: string;
  index: number;
}

/**
 * The fields of the library's `DropResult` this module reads. Declared structurally so `lib/`
 * depends on nothing above it; the real `DropResult` is assignable to it.
 */
export interface DragDrop {
  type: string;
  draggableId: string;
  source: DropLocation;
  destination?: DropLocation | null;
}

/** The body of `POST /api/cards/{card_id}/move`, in the hook's variable names. */
export interface CardMove {
  cardId: Id;
  toListId: Id;
  index: number;
  prevId: Id | null;
  nextId: Id | null;
}

/** The body of `POST /api/lists/{list_id}/move`: the index alone (Section 5.5). */
export interface ListMove {
  listId: Id;
  index: number;
}

export type DropOutcome =
  { kind: 'card'; card: CardMove } | { kind: 'list'; list: ListMove } | { kind: 'none' };

/** `listId -> active card ids`, the `cardOrder` of the cached `BoardState` (Section 5.4.2). */
export type CardOrder = Readonly<Record<Id, readonly Id[]>>;

const NO_MOVE: DropOutcome = { kind: 'none' };

/** The two ids a moved card lands between (Section 4.9's neighbour contract). */
export interface Neighbours {
  prevId: Id | null;
  nextId: Id | null;
}

/**
 * The ids that will surround the card after the move. `order` is the destination list's order
 * as the cache holds it; the moved card is removed first, because `index` is defined over
 * that order whether the card stayed in its list or crossed into another one.
 *
 * Exported because a drop is not the only mover: the `,` / `.` shortcuts send the card to
 * `index: 0` of the neighbouring list (Section 2.8) and need the same two ids for the same
 * endpoint, and `hooks/useKeyboardShortcuts.ts` must not compute them a second time.
 */
export function neighboursAt(order: readonly Id[], cardId: Id, index: number): Neighbours {
  const rest = order.filter((id) => id !== cardId);
  return { prevId: rest[index - 1] ?? null, nextId: rest[index] ?? null };
}

/**
 * Where a drop landed, or `null` when it moved nothing: a drag cancelled outside every
 * droppable, or dropped back into the slot it came from.
 *
 * `lib/cardDnd.ts` opens with the same question, so the two cases that mean "send nothing"
 * are decided here for both surfaces.
 */
export function dropDestination(drop: DragDrop): DropLocation | null {
  const { source, destination } = drop;
  if (destination === undefined || destination === null) return null;
  if (destination.droppableId === source.droppableId && destination.index === source.index) {
    return null;
  }
  return destination;
}

/**
 * What one drop should send, or `none` when it should send nothing: a drag cancelled outside
 * every droppable, a drop back into the slot it came from, or an id that is not one of ours.
 */
export function moveFromDrop(drop: DragDrop, cardOrder: CardOrder): DropOutcome {
  const destination = dropDestination(drop);
  if (destination === null) return NO_MOVE;

  if (drop.type === LIST_DRAG_TYPE) {
    const listId = parseListId(drop.draggableId);
    if (listId === null) return NO_MOVE;
    return { kind: 'list', list: { listId, index: destination.index } };
  }

  const cardId = parseCardId(drop.draggableId);
  const toListId = parseListId(destination.droppableId);
  if (cardId === null || toListId === null) return NO_MOVE;
  const { prevId, nextId } = neighboursAt(cardOrder[toListId] ?? [], cardId, destination.index);
  return { kind: 'card', card: { cardId, toListId, index: destination.index, prevId, nextId } };
}
