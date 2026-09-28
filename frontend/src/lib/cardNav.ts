/**
 * Where the keyboard's selection goes next (Sections 2.8 and 5.9): J/K down and up a list, the
 * arrows across to the neighbouring one, `,` / `.` to the previous or next list, and the slot `N`
 * inserts a composer into.
 *
 * All of it is arithmetic over the board's own order — `BoardState.listOrder` and
 * `BoardState.cardOrder`, which already hold the active lists and cards sorted by
 * `(position, id)` — so it is pure, it lives here rather than in `hooks/useKeyboardShortcuts.ts`,
 * and it is the one piece of the shortcut map that can be wrong in a way no rendering test would
 * catch. No position is ever computed: a move gets a list id and `index: 0`, exactly as the drag
 * contract of `lib/boardDnd.ts` does.
 */
import type { Id } from './boardState';

/** The two fields of `BoardState` this module reads; `BoardState` satisfies it as it stands. */
export interface CardLayout {
  /** Active lists, left to right. */
  listOrder: readonly Id[];
  /** `listId -> active card ids, top to bottom`. */
  cardOrder: Readonly<Record<Id, readonly Id[]>>;
}

/** Backwards (K, `,`, ArrowLeft/Up) or forwards (J, `.`, ArrowRight/Down). */
export type NavDirection = -1 | 1;

/** Where one card sits: its list and both indices. */
interface CardSlot {
  listId: Id;
  listIndex: number;
  cardIndex: number;
}

/** A list and a 0-based slot in it — what `N` hands the composer (Section 2.8). */
export interface ComposerSlot {
  listId: Id;
  index: number;
}

const EMPTY: readonly Id[] = [];

function cardsOf(layout: CardLayout, listId: Id): readonly Id[] {
  return layout.cardOrder[listId] ?? EMPTY;
}

/** The card's list and indices, or `null` when the board does not show it (archived, filtered). */
function locateCard(layout: CardLayout, cardId: Id): CardSlot | null {
  for (const [listIndex, listId] of layout.listOrder.entries()) {
    const cardIndex = cardsOf(layout, listId).indexOf(cardId);
    if (cardIndex !== -1) return { listId, listIndex, cardIndex };
  }
  return null;
}

/** The first card of the leftmost list that has one: where J starts with nothing selected. */
export function firstCard(layout: CardLayout): Id | null {
  for (const listId of layout.listOrder) {
    const first = cardsOf(layout, listId)[0];
    if (first !== undefined) return first;
  }
  return null;
}

/** J / K: the next or previous card of the same list, or `null` at either end. */
export function cardInList(layout: CardLayout, cardId: Id, direction: NavDirection): Id | null {
  const slot = locateCard(layout, cardId);
  if (slot === null) return null;
  return cardsOf(layout, slot.listId)[slot.cardIndex + direction] ?? null;
}

/**
 * ArrowLeft / ArrowRight: the card at the same index in the neighbouring list, clamped to that
 * list's last card (Section 2.8). An empty neighbour, or no neighbour at all, selects nothing.
 */
export function cardInNeighbourList(
  layout: CardLayout,
  cardId: Id,
  direction: NavDirection,
): Id | null {
  const slot = locateCard(layout, cardId);
  if (slot === null) return null;
  const listId = layout.listOrder[slot.listIndex + direction];
  if (listId === undefined) return null;
  // An empty neighbour clamps to index -1, which is the same "nothing to select" as no neighbour.
  const cards = cardsOf(layout, listId);
  return cards[Math.min(slot.cardIndex, cards.length - 1)] ?? null;
}

/** `,` / `.`: the list the card moves to the top of, or `null` when it is already at the edge. */
export function neighbourListId(
  layout: CardLayout,
  cardId: Id,
  direction: NavDirection,
): Id | null {
  const slot = locateCard(layout, cardId);
  if (slot === null) return null;
  return layout.listOrder[slot.listIndex + direction] ?? null;
}

/** `N`: the slot directly below the card, which is its own index plus one (Section 2.8). */
export function slotBelowCard(layout: CardLayout, cardId: Id): ComposerSlot | null {
  const slot = locateCard(layout, cardId);
  if (slot === null) return null;
  return { listId: slot.listId, index: slot.cardIndex + 1 };
}
