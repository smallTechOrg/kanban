import { describe, expect, it } from 'vitest';
import {
  BOARD_DROPPABLE_ID,
  CARD_DRAG_TYPE,
  LIST_DRAG_TYPE,
  cardDragId,
  isDragLocked,
  listDropId,
  moveFromDrop,
  parseCardId,
  parseListId,
  type CardOrder,
  type DragDrop,
} from './boardDnd';

/** `[A, B, C]` in list 11 and `[X, Y]` in list 12, as the board cache holds them. */
const A = 101;
const B = 102;
const C = 103;
const X = 201;
const Y = 202;

const CARD_ORDER: CardOrder = { 11: [A, B, C], 12: [X, Y] };

function cardDrop(from: number, to: number, listFrom = 11, listTo = 11): DragDrop {
  return {
    type: CARD_DRAG_TYPE,
    draggableId: cardDragId(listFrom === 11 ? ([A, B, C][from] ?? A) : ([X, Y][from] ?? X)),
    source: { droppableId: listDropId(listFrom), index: from },
    destination: { droppableId: listDropId(listTo), index: to },
  };
}

describe('drag ids', () => {
  it('prefixes and parses list and card ids', () => {
    expect(listDropId(12)).toBe('list-12');
    expect(cardDragId(101)).toBe('card-101');
    expect(parseListId('list-12')).toBe(12);
    expect(parseCardId('card-101')).toBe(101);
  });

  it('parses the negative id an optimistic card carries', () => {
    expect(parseCardId(cardDragId(-1764072000000))).toBe(-1764072000000);
  });

  it('refuses a string that is not one of ours', () => {
    expect(parseListId('card-101')).toBeNull();
    expect(parseCardId(BOARD_DROPPABLE_ID)).toBeNull();
    expect(parseListId('list-abc')).toBeNull();
  });

  it('locks dragging for an observer only', () => {
    expect(isDragLocked('observer')).toBe(true);
    expect(isDragLocked('member')).toBe(false);
    expect(isDragLocked(undefined)).toBe(false);
  });
});

describe('moveFromDrop', () => {
  it('sends nothing when the drag ended outside every droppable', () => {
    const drop: DragDrop = {
      type: CARD_DRAG_TYPE,
      draggableId: cardDragId(A),
      source: { droppableId: listDropId(11), index: 0 },
      destination: null,
    };
    expect(moveFromDrop(drop, CARD_ORDER)).toEqual({ kind: 'none' });
    expect(moveFromDrop({ ...drop, destination: undefined }, CARD_ORDER)).toEqual({ kind: 'none' });
  });

  it('sends nothing when the card came back to the slot it left', () => {
    expect(moveFromDrop(cardDrop(1, 1), CARD_ORDER)).toEqual({ kind: 'none' });
  });

  /** The regression Section 5.5 spells out: the pre-removal order would send A as its own prev. */
  it('reads the neighbours of a same-list downward move from the post-removal order', () => {
    expect(moveFromDrop(cardDrop(0, 1), CARD_ORDER)).toEqual({
      kind: 'card',
      card: { cardId: A, toListId: 11, index: 1, prevId: B, nextId: C },
    });
  });

  it('sends a null prev when a card moves to the top of its list', () => {
    expect(moveFromDrop(cardDrop(2, 0), CARD_ORDER)).toEqual({
      kind: 'card',
      card: { cardId: C, toListId: 11, index: 0, prevId: null, nextId: A },
    });
  });

  it('sends a null next when a card moves to the bottom of its list', () => {
    expect(moveFromDrop(cardDrop(0, 2), CARD_ORDER)).toEqual({
      kind: 'card',
      card: { cardId: A, toListId: 11, index: 2, prevId: C, nextId: null },
    });
  });

  it('reads the neighbours of a cross-list drop from the destination list', () => {
    expect(moveFromDrop(cardDrop(0, 1, 11, 12), CARD_ORDER)).toEqual({
      kind: 'card',
      card: { cardId: A, toListId: 12, index: 1, prevId: X, nextId: Y },
    });
  });

  it('treats a list this client has not cached as empty', () => {
    expect(moveFromDrop(cardDrop(0, 0, 11, 99), CARD_ORDER)).toEqual({
      kind: 'card',
      card: { cardId: A, toListId: 99, index: 0, prevId: null, nextId: null },
    });
  });

  it('sends the index alone for a column reorder', () => {
    const drop: DragDrop = {
      type: LIST_DRAG_TYPE,
      draggableId: listDropId(12),
      source: { droppableId: BOARD_DROPPABLE_ID, index: 1 },
      destination: { droppableId: BOARD_DROPPABLE_ID, index: 0 },
    };
    expect(moveFromDrop(drop, CARD_ORDER)).toEqual({
      kind: 'list',
      list: { listId: 12, index: 0 },
    });
  });

  it('sends nothing when an id cannot be parsed', () => {
    const list: DragDrop = {
      type: LIST_DRAG_TYPE,
      draggableId: 'board',
      source: { droppableId: BOARD_DROPPABLE_ID, index: 1 },
      destination: { droppableId: BOARD_DROPPABLE_ID, index: 0 },
    };
    expect(moveFromDrop(list, CARD_ORDER)).toEqual({ kind: 'none' });
    expect(moveFromDrop({ ...cardDrop(0, 1), draggableId: 'x-1' }, CARD_ORDER)).toEqual({
      kind: 'none',
    });
    expect(
      moveFromDrop(
        { ...cardDrop(0, 1), destination: { droppableId: 'trash', index: 0 } },
        CARD_ORDER,
      ),
    ).toEqual({ kind: 'none' });
  });
});
