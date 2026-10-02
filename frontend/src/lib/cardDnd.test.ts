import { describe, expect, it } from 'vitest';
import type { DragDrop } from './boardDnd';
import {
  ITEM_DRAG_TYPE,
  cardMoveFromDrop,
  itemDragId,
  itemOrder,
  itemsDropId,
  parseItemId,
  visibleItems,
} from './cardDnd';

/** Card 101's items: `[A, B, C]`, with A already checked. */
const A = 501;
const B = 502;
const C = 503;

const ITEMS = [
  { id: A, is_checked: true },
  { id: B, is_checked: false },
  { id: C, is_checked: false },
];

const ORDER: readonly number[] = itemOrder(ITEMS);

function itemDrop(itemId: number, from: number, to: number): DragDrop {
  return {
    type: ITEM_DRAG_TYPE,
    draggableId: itemDragId(itemId),
    source: { droppableId: itemsDropId(101), index: from },
    destination: { droppableId: itemsDropId(101), index: to },
  };
}

describe('drag ids', () => {
  it('prefixes the card and item ids the droppable uses', () => {
    expect(itemsDropId(101)).toBe('items-101');
    expect(itemDragId(501)).toBe('item-501');
  });

  it('parses its own ids back', () => {
    expect(parseItemId('item-501')).toBe(501);
  });

  it('parses the negative id an optimistic row carries', () => {
    expect(parseItemId(itemDragId(-1764072000000))).toBe(-1764072000000);
  });

  it('refuses a string that is not one of ours', () => {
    expect(parseItemId(itemsDropId(101))).toBeNull();
    expect(parseItemId('item-abc')).toBeNull();
    expect(parseItemId('card-101')).toBeNull();
  });
});

describe('visibleItems', () => {
  it('shows every row, or only the unchecked ones', () => {
    expect(visibleItems(ITEMS, false)).toHaveLength(3);
    expect(visibleItems(ITEMS, true).map((item) => item.id)).toEqual([B, C]);
  });
});

describe('itemOrder', () => {
  it('lists the ids in order', () => {
    expect(ORDER).toEqual([A, B, C]);
  });

  it('leaves the checked rows out when they are hidden', () => {
    expect(itemOrder(ITEMS, true)).toEqual([B, C]);
  });

  it('is empty for a card with no items', () => {
    expect(itemOrder([])).toEqual([]);
  });
});

describe('cardMoveFromDrop', () => {
  it('sends nothing when the drag ended outside every droppable', () => {
    expect(cardMoveFromDrop({ ...itemDrop(A, 0, 1), destination: null }, ORDER)).toEqual({
      kind: 'none',
    });
    expect(cardMoveFromDrop({ ...itemDrop(A, 0, 1), destination: undefined }, ORDER)).toEqual({
      kind: 'none',
    });
  });

  it('sends nothing when the row was dropped back where it started', () => {
    expect(cardMoveFromDrop(itemDrop(B, 1, 1), ORDER)).toEqual({ kind: 'none' });
  });

  it('reads the neighbours from the order with the dragged item removed', () => {
    // A moves down to the end: the neighbours are C and nothing, never A itself.
    expect(cardMoveFromDrop(itemDrop(A, 0, 2), ORDER)).toEqual({
      kind: 'item',
      item: { itemId: A, index: 2, prevId: C, nextId: null },
    });
    // C moves up to the top: nothing before it, A after it.
    expect(cardMoveFromDrop(itemDrop(C, 2, 0), ORDER)).toEqual({
      kind: 'item',
      item: { itemId: C, index: 0, prevId: null, nextId: A },
    });
  });

  it('treats a card it knows nothing about as empty', () => {
    expect(cardMoveFromDrop(itemDrop(A, 1, 0), [])).toEqual({
      kind: 'item',
      item: { itemId: A, index: 0, prevId: null, nextId: null },
    });
  });

  it('sends the neighbours the user saw and the index the cache needs', () => {
    // The card hides its one checked row, so the user sees [B, C] while the cache holds
    // [A, B, C]. Dropping C above B is "before B" — index 1 over the full order, not 0.
    const rendered = itemOrder(ITEMS, true);
    const drop: DragDrop = {
      type: ITEM_DRAG_TYPE,
      draggableId: itemDragId(C),
      source: { droppableId: itemsDropId(101), index: 1 },
      destination: { droppableId: itemsDropId(101), index: 0 },
    };
    expect(cardMoveFromDrop(drop, rendered, ORDER)).toEqual({
      kind: 'item',
      item: { itemId: C, index: 1, prevId: null, nextId: B },
    });
  });

  it('appends when the drop landed after the last row the user saw', () => {
    const rendered = itemOrder(ITEMS, true);
    const drop: DragDrop = {
      type: ITEM_DRAG_TYPE,
      draggableId: itemDragId(B),
      source: { droppableId: itemsDropId(101), index: 0 },
      destination: { droppableId: itemsDropId(101), index: 1 },
    };
    expect(cardMoveFromDrop(drop, rendered, ORDER)).toEqual({
      kind: 'item',
      item: { itemId: B, index: 2, prevId: C, nextId: null },
    });
  });

  it('appends when the row it landed before is not in the full order at all', () => {
    // A row the card cache has not caught up with yet: its slot cannot be located, so the
    // move can only append, and the neighbours still say what the user saw.
    const drop = { ...itemDrop(C, 0, 1) };
    expect(cardMoveFromDrop(drop, [A, B, C], [C])).toEqual({
      kind: 'item',
      item: { itemId: C, index: 0, prevId: A, nextId: B },
    });
  });

  it('ignores a drag whose id is not one of ours', () => {
    expect(cardMoveFromDrop({ ...itemDrop(A, 0, 1), draggableId: 'card-101' }, ORDER)).toEqual({
      kind: 'none',
    });
  });
});
