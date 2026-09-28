import { describe, expect, it } from 'vitest';
import type { DragDrop } from './boardDnd';
import {
  CHECKLIST_DRAG_TYPE,
  CHECKLIST_ITEM_DRAG_TYPE,
  cardMoveFromDrop,
  checklistDropId,
  checklistsDropId,
  itemDragId,
  itemOrder,
  parseChecklistId,
  parseItemId,
  visibleItems,
  type ItemOrder,
} from './cardDnd';

/** Two checklists on card 101: `[A, B, C]` on 51 and `[X, Y]` on 52. */
const A = 501;
const B = 502;
const C = 503;
const X = 601;
const Y = 602;

const CHECKLISTS = [
  {
    id: 51,
    items: [
      { id: A, is_checked: true },
      { id: B, is_checked: false },
      { id: C, is_checked: false },
    ],
  },
  {
    id: 52,
    items: [
      { id: X, is_checked: false },
      { id: Y, is_checked: false },
    ],
  },
];

const ORDER: ItemOrder = itemOrder(CHECKLISTS);

function itemDrop(itemId: number, from: number, to: number, listFrom = 51, listTo = 51): DragDrop {
  return {
    type: CHECKLIST_ITEM_DRAG_TYPE,
    draggableId: itemDragId(itemId),
    source: { droppableId: checklistDropId(listFrom), index: from },
    destination: { droppableId: checklistDropId(listTo), index: to },
  };
}

function checklistDrop(checklistId: number, from: number, to: number): DragDrop {
  return {
    type: CHECKLIST_DRAG_TYPE,
    draggableId: checklistDropId(checklistId),
    source: { droppableId: checklistsDropId(101), index: from },
    destination: { droppableId: checklistsDropId(101), index: to },
  };
}

describe('drag ids', () => {
  it('prefixes the card, checklist and item ids the two droppables use', () => {
    expect(checklistsDropId(101)).toBe('checklists-101');
    expect(checklistDropId(51)).toBe('checklist-51');
    expect(itemDragId(501)).toBe('item-501');
  });

  it('parses its own ids back', () => {
    expect(parseChecklistId('checklist-51')).toBe(51);
    expect(parseItemId('item-501')).toBe(501);
  });

  it('parses the negative id an optimistic row carries', () => {
    expect(parseItemId(itemDragId(-1764072000000))).toBe(-1764072000000);
  });

  it('refuses a string that is not one of ours', () => {
    expect(parseChecklistId('item-501')).toBeNull();
    expect(parseItemId(checklistDropId(51))).toBeNull();
    expect(parseChecklistId('checklist-abc')).toBeNull();
    // "checklists-101" is the sections' droppable, not a checklist: the prefix must not match.
    expect(parseChecklistId(checklistsDropId(101))).toBeNull();
  });
});

describe('visibleItems', () => {
  it('shows every row, or only the unchecked ones', () => {
    const items = CHECKLISTS[0]?.items ?? [];
    expect(visibleItems(items, false)).toHaveLength(3);
    expect(visibleItems(items, true).map((item) => item.id)).toEqual([B, C]);
  });
});

describe('itemOrder', () => {
  it('maps every checklist to its ids, in order', () => {
    expect(ORDER).toEqual({ 51: [A, B, C], 52: [X, Y] });
  });

  it('leaves the checked rows out of a checklist that hides them', () => {
    expect(itemOrder(CHECKLISTS, [51])).toEqual({ 51: [B, C], 52: [X, Y] });
  });

  it('is empty for a card with no checklists', () => {
    expect(itemOrder([])).toEqual({});
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
    expect(cardMoveFromDrop(checklistDrop(51, 0, 0), ORDER)).toEqual({ kind: 'none' });
  });

  it('reorders a whole checklist by index alone', () => {
    expect(cardMoveFromDrop(checklistDrop(52, 1, 0), ORDER)).toEqual({
      kind: 'checklist',
      checklist: { checklistId: 52, index: 0 },
    });
  });

  it('ignores a checklist drag whose id is not one of ours', () => {
    const drop = { ...checklistDrop(52, 1, 0), draggableId: 'card-101' };
    expect(cardMoveFromDrop(drop, ORDER)).toEqual({ kind: 'none' });
  });

  it('reads the neighbours from the order with the dragged item removed', () => {
    // A moves down to the end of its own checklist: the neighbours are B and nothing, never A.
    expect(cardMoveFromDrop(itemDrop(A, 0, 2), ORDER)).toEqual({
      kind: 'item',
      item: { itemId: A, toChecklistId: 51, index: 2, prevId: C, nextId: null },
    });
    // C moves up to the top: nothing before it, A after it.
    expect(cardMoveFromDrop(itemDrop(C, 2, 0), ORDER)).toEqual({
      kind: 'item',
      item: { itemId: C, toChecklistId: 51, index: 0, prevId: null, nextId: A },
    });
  });

  it('crosses into another checklist on the same card', () => {
    expect(cardMoveFromDrop(itemDrop(A, 0, 1, 51, 52), ORDER)).toEqual({
      kind: 'item',
      item: { itemId: A, toChecklistId: 52, index: 1, prevId: X, nextId: Y },
    });
  });

  it('treats a checklist it knows nothing about as empty', () => {
    expect(cardMoveFromDrop(itemDrop(A, 0, 0, 51, 99), ORDER)).toEqual({
      kind: 'item',
      item: { itemId: A, toChecklistId: 99, index: 0, prevId: null, nextId: null },
    });
  });

  it('sends the neighbours the user saw and the index the cache needs', () => {
    // Checklist 51 hides its one checked row, so the user sees [B, C] while the cache holds
    // [A, B, C]. Dropping C above B is "before B" — index 1 over the full order, not 0.
    const rendered = itemOrder(CHECKLISTS, [51]);
    const drop = {
      type: CHECKLIST_ITEM_DRAG_TYPE,
      draggableId: itemDragId(C),
      source: { droppableId: checklistDropId(51), index: 1 },
      destination: { droppableId: checklistDropId(51), index: 0 },
    };
    expect(cardMoveFromDrop(drop, rendered, ORDER)).toEqual({
      kind: 'item',
      item: { itemId: C, toChecklistId: 51, index: 1, prevId: null, nextId: B },
    });
  });

  it('appends when the drop landed after the last row the user saw', () => {
    const rendered = itemOrder(CHECKLISTS, [51]);
    const drop = {
      type: CHECKLIST_ITEM_DRAG_TYPE,
      draggableId: itemDragId(B),
      source: { droppableId: checklistDropId(51), index: 0 },
      destination: { droppableId: checklistDropId(51), index: 1 },
    };
    expect(cardMoveFromDrop(drop, rendered, ORDER)).toEqual({
      kind: 'item',
      item: { itemId: B, toChecklistId: 51, index: 2, prevId: C, nextId: null },
    });
  });

  it('appends when the row it landed before is not in the full order at all', () => {
    // A row the card cache has not caught up with yet: its slot cannot be located, so the
    // move can only append, and the neighbours still say what the user saw.
    const toMissing = { ...itemDrop(A, 0, 1), draggableId: itemDragId(C) };
    expect(cardMoveFromDrop(toMissing, { 51: [A, B, C] }, { 51: [C] })).toEqual({
      kind: 'item',
      item: { itemId: C, toChecklistId: 51, index: 0, prevId: A, nextId: B },
    });
  });

  it('ignores an item drag whose ids are not one of ours', () => {
    expect(cardMoveFromDrop({ ...itemDrop(A, 0, 1), draggableId: 'card-101' }, ORDER)).toEqual({
      kind: 'none',
    });
    const strange = { ...itemDrop(A, 0, 1), destination: { droppableId: 'list-11', index: 1 } };
    expect(cardMoveFromDrop(strange, ORDER)).toEqual({ kind: 'none' });
  });
});
