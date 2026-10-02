import { describe, expect, it } from 'vitest';
import {
  cardInList,
  cardInNeighbourList,
  firstCard,
  neighbourListId,
  slotBelowCard,
  type CardLayout,
} from './cardNav';

/** Three lists: `[A, B, C]`, `[X]` and one empty column, as `BoardState` holds them. */
const A = 101;
const B = 102;
const C = 103;
const X = 201;

const LAYOUT: CardLayout = {
  listOrder: [11, 12, 13],
  cardOrder: { 11: [A, B, C], 12: [X] },
};

describe('firstCard', () => {
  it('is the first card of the leftmost list that has one', () => {
    expect(firstCard(LAYOUT)).toBe(A);
    expect(firstCard({ listOrder: [13, 12], cardOrder: LAYOUT.cardOrder })).toBe(X);
  });

  it('is null on a board with no cards at all', () => {
    expect(firstCard({ listOrder: [13], cardOrder: {} })).toBeNull();
  });
});

describe('cardInList', () => {
  it('walks down and up the same list', () => {
    expect(cardInList(LAYOUT, A, 1)).toBe(B);
    expect(cardInList(LAYOUT, C, -1)).toBe(B);
  });

  it('stops at both ends', () => {
    expect(cardInList(LAYOUT, C, 1)).toBeNull();
    expect(cardInList(LAYOUT, A, -1)).toBeNull();
  });

  it('answers null for an unknown card', () => {
    expect(cardInList(LAYOUT, 999, 1)).toBeNull();
  });
});

describe('cardInNeighbourList', () => {
  it('keeps the index and clamps to the neighbour’s last card', () => {
    expect(cardInNeighbourList(LAYOUT, A, 1)).toBe(X);
    expect(cardInNeighbourList(LAYOUT, C, 1)).toBe(X);
    expect(cardInNeighbourList(LAYOUT, X, -1)).toBe(A);
  });

  it('selects nothing at the edge of the board or beside an empty list', () => {
    expect(cardInNeighbourList(LAYOUT, A, -1)).toBeNull();
    expect(cardInNeighbourList(LAYOUT, X, 1)).toBeNull();
    expect(cardInNeighbourList(LAYOUT, 999, 1)).toBeNull();
  });
});

describe('neighbourListId', () => {
  it('names the list on either side, empty or not', () => {
    expect(neighbourListId(LAYOUT, A, 1)).toBe(12);
    expect(neighbourListId(LAYOUT, X, 1)).toBe(13);
    expect(neighbourListId(LAYOUT, X, -1)).toBe(11);
  });

  it('answers null at the edges and for an unknown card', () => {
    expect(neighbourListId(LAYOUT, A, -1)).toBeNull();
    expect(neighbourListId(LAYOUT, 999, -1)).toBeNull();
  });
});

describe('slotBelowCard', () => {
  it('is the card’s own index plus one', () => {
    expect(slotBelowCard(LAYOUT, A)).toEqual({ listId: 11, index: 1 });
    expect(slotBelowCard(LAYOUT, C)).toEqual({ listId: 11, index: 3 });
  });

  it('answers null for an unknown card', () => {
    expect(slotBelowCard(LAYOUT, 999)).toBeNull();
  });
});
