/**
 * The Position select of the Move and Copy popovers (Section 2.6.5), as pure arithmetic.
 *
 * The one thing that can be wrong here is an off-by-one, and it is wrong in a way no rendering
 * test would notice: the select shows 1-based slots, the move and copy endpoints take a 0-based
 * `index` over the destination's **active** siblings, and a card being moved inside its own list
 * is not one of those siblings — the server excludes it (`place_in_container`, Section 4.9), so
 * the list it already sits in offers one slot fewer than every other list. A copy is a new row
 * and excludes nothing.
 *
 * No position is ever computed here: the popovers send the index this module produces and the
 * server answers with the `position` it chose (CLAUDE.md section 3).
 */

import type { Id } from './boardState';

export interface SlotsInput {
  /** Active cards in the destination list, as `GET /api/boards/{id}/lists` counts them. */
  cardCount: number;
  /**
   * The 0-based slot the moved card occupies in this very list, or `null` when it is somewhere
   * else — and always `null` for a copy, whose new row takes a slot of its own.
   */
  currentIndex: number | null;
}

export interface Slots {
  /** How many 1-based slots the select offers: the siblings it can land between, plus one. */
  count: number;
  /** The slot that reads "3 (current)", or `null` when the card is not in this list. */
  currentSlot: number | null;
}

/** The slots a destination list offers, and which of them the card is in now. */
export function destinationSlots({ cardCount, currentIndex }: SlotsInput): Slots {
  const siblings = currentIndex === null ? cardCount : Math.max(0, cardCount - 1);
  return {
    count: siblings + 1,
    currentSlot: currentIndex === null ? null : Math.min(currentIndex + 1, siblings + 1),
  };
}

/** "3" or "3 (current)" (Section 2.6.5). */
export function slotLabel(slot: number, currentSlot: number | null): string {
  return slot === currentSlot ? `${String(slot)} (current)` : String(slot);
}

/** The slot a freshly opened select shows: where the card is now, or the top of the list. */
export function defaultSlot({ currentSlot }: Slots): number {
  return currentSlot ?? 1;
}

/** The `index` the move and copy bodies carry: the select's 1-based slot minus one. */
export function slotIndex(slot: number): number {
  return Math.max(0, slot - 1);
}

/**
 * The `to_board_id` a move body carries: the chosen board, or `undefined` when it is the board
 * the row already lives on (Sections 4.5 and 4.9).
 *
 * Both `Board` selects always report a board, this one included, and the server reads the same
 * field as "hand this row to another board" — a same-board move that spelled it out would take
 * the cross-board path, reassign the `short_id` and strip the labels. The card move and the list
 * move ask the same question, so they ask it here rather than each deciding it again.
 */
export function crossBoardTarget(boardId: number, toBoardId: Id | undefined): Id | undefined {
  return toBoardId === undefined || toBoardId === boardId ? undefined : toBoardId;
}
