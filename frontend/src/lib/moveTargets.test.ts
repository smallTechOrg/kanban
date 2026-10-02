import { describe, expect, it } from 'vitest';
import {
  crossBoardTarget,
  defaultSlot,
  destinationSlots,
  slotIndex,
  slotLabel,
} from './moveTargets';

describe('destinationSlots', () => {
  it('offers one slot more than a list the card is not in', () => {
    expect(destinationSlots({ cardCount: 3, currentIndex: null })).toEqual({
      count: 4,
      currentSlot: null,
    });
  });

  it('excludes the card itself from the list it already sits in', () => {
    // Three cards, ours is the second: the other two make three slots, and we are in slot 2.
    expect(destinationSlots({ cardCount: 3, currentIndex: 1 })).toEqual({
      count: 3,
      currentSlot: 2,
    });
  });

  it('offers a single slot in an empty list', () => {
    expect(destinationSlots({ cardCount: 0, currentIndex: null })).toEqual({
      count: 1,
      currentSlot: null,
    });
  });

  it('offers a single slot in a list holding only this card', () => {
    expect(destinationSlots({ cardCount: 1, currentIndex: 0 })).toEqual({
      count: 1,
      currentSlot: 1,
    });
  });

  it('clamps a current slot that a stale count puts past the end', () => {
    expect(destinationSlots({ cardCount: 1, currentIndex: 4 })).toEqual({
      count: 1,
      currentSlot: 1,
    });
  });

  it('never returns a negative sibling count', () => {
    expect(destinationSlots({ cardCount: 0, currentIndex: 0 })).toEqual({
      count: 1,
      currentSlot: 1,
    });
  });
});

describe('slotLabel', () => {
  it('marks the slot the card is in', () => {
    expect(slotLabel(3, 3)).toBe('3 (current)');
  });

  it('leaves every other slot as its number', () => {
    expect(slotLabel(2, 3)).toBe('2');
    expect(slotLabel(2, null)).toBe('2');
  });
});

describe('defaultSlot', () => {
  it('opens on the slot the card is in', () => {
    expect(defaultSlot({ count: 4, currentSlot: 3 })).toBe(3);
  });

  it('opens on the top of a list the card is not in', () => {
    expect(defaultSlot({ count: 4, currentSlot: null })).toBe(1);
  });
});

describe('slotIndex', () => {
  it('turns the 1-based slot into the 0-based index the endpoints take', () => {
    expect(slotIndex(1)).toBe(0);
    expect(slotIndex(5)).toBe(4);
  });

  it('never sends a negative index', () => {
    expect(slotIndex(0)).toBe(0);
  });
});

describe('crossBoardTarget', () => {
  it('is undefined when the select named the board the row already lives on', () => {
    expect(crossBoardTarget(7, 7)).toBeUndefined();
  });

  it('is undefined when no board was named at all', () => {
    expect(crossBoardTarget(7, undefined)).toBeUndefined();
  });

  it('is the chosen board when it is a different one', () => {
    expect(crossBoardTarget(7, 3)).toBe(3);
  });
});
