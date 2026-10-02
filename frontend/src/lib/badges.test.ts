import { describe, expect, it } from 'vitest';
import { cardBadges, dueState, itemCounts, itemProgress, DUE_SOON_MS } from './badges';
import type { CardRow, Id } from './boardState';

// Dates are built with local-time constructors so the assertions hold in any timezone.
const NOW = new Date(2026, 8, 24, 18, 0, 0); // 24 Sep 2026, 18:00 local

function iso(date: Date): string {
  return date.toISOString();
}

function offsetFromNow(ms: number): string {
  return iso(new Date(NOW.getTime() + ms));
}

function makeCard(overrides: Partial<CardRow> & { id?: Id } = {}): CardRow {
  return {
    id: 101,
    board_id: 7,
    list_id: 11,
    short_id: 12,
    title: 'Write launch announcement',
    position: 65536,
    is_archived: false,
    start_at: null,
    due_at: null,
    due_complete: false,
    label_ids: [],
    items: [],
    badges: {
      description: false,
      item_done: 0,
      item_total: 0,
    },
    created_at: '2026-09-03T11:00:00.000Z',
    updated_at: '2026-09-24T17:58:41.120Z',
    ...overrides,
  };
}

describe('dueState', () => {
  it('is none without a due date', () => {
    expect(dueState(makeCard(), NOW)).toBe('none');
  });

  it('is none for an unparseable due date', () => {
    expect(dueState(makeCard({ due_at: 'not-a-date' }), NOW)).toBe('none');
  });

  it('is none while the due date is further away than a day', () => {
    expect(dueState(makeCard({ due_at: offsetFromNow(DUE_SOON_MS + 1) }), NOW)).toBe('none');
  });

  it('is soon inside the last 24 hours', () => {
    expect(dueState(makeCard({ due_at: offsetFromNow(DUE_SOON_MS - 1) }), NOW)).toBe('soon');
    expect(dueState(makeCard({ due_at: offsetFromNow(60_000) }), NOW)).toBe('soon');
  });

  it('is overdue once the due date has passed', () => {
    expect(dueState(makeCard({ due_at: offsetFromNow(-1) }), NOW)).toBe('overdue');
  });

  it('is complete whenever the card is ticked, past or future', () => {
    expect(dueState(makeCard({ due_at: offsetFromNow(-1), due_complete: true }), NOW)).toBe(
      'complete',
    );
    expect(
      dueState(makeCard({ due_at: offsetFromNow(DUE_SOON_MS * 7), due_complete: true }), NOW),
    ).toBe('complete');
  });
});

describe('cardBadges', () => {
  it('shows nothing for a bare card', () => {
    expect(cardBadges(makeCard(), NOW)).toEqual([]);
  });

  it('renders the badges of Section 2.5.3 in order', () => {
    const badges = cardBadges(
      makeCard({
        due_at: iso(new Date(2026, 8, 26, 15, 0)),
        badges: {
          description: true,
          item_done: 2,
          item_total: 5,
        },
      }),
      NOW,
    );
    expect(badges).toEqual([
      { kind: 'due', text: 'Sep 26', state: 'none' },
      { kind: 'description' },
      { kind: 'items', text: '2/5', complete: false },
    ]);
  });

  it('writes a range when the card also has a start date', () => {
    const badges = cardBadges(
      makeCard({
        start_at: iso(new Date(2026, 8, 24, 9, 0)),
        due_at: iso(new Date(2026, 9, 1, 15, 0)),
      }),
      NOW,
    );
    expect(badges).toEqual([{ kind: 'due', text: 'Sep 24 – Oct 1', state: 'none' }]);
  });

  it('shows "Started" in the same slot when only a start date is set', () => {
    const badges = cardBadges(makeCard({ start_at: iso(new Date(2026, 8, 20, 9, 0)) }), NOW);
    expect(badges).toEqual([{ kind: 'start', text: 'Started Sep 20' }]);
  });

  it('marks a card whose items are all checked complete', () => {
    const badges = cardBadges(
      makeCard({
        badges: {
          description: false,
          item_done: 4,
          item_total: 4,
        },
      }),
      NOW,
    );
    expect(badges).toEqual([{ kind: 'items', text: '4/4', complete: true }]);
  });

  it('carries the due state on to the badge', () => {
    const badges = cardBadges(makeCard({ due_at: offsetFromNow(-1) }), NOW);
    expect(badges[0]?.state).toBe('overdue');
  });
});

describe('itemProgress', () => {
  it('counts the checked rows', () => {
    expect(itemProgress([{ is_checked: true }, { is_checked: false }])).toEqual({
      done: 1,
      total: 2,
    });
    expect(itemProgress([])).toEqual({ done: 0, total: 0 });
  });
});

describe('itemCounts', () => {
  it('is zero for a card with no items', () => {
    expect(itemCounts([])).toEqual({ item_done: 0, item_total: 0 });
  });

  it('counts the card\u2019s checked items', () => {
    expect(
      itemCounts([{ is_checked: true }, { is_checked: true }, { is_checked: false }]),
    ).toEqual({ item_done: 2, item_total: 3 });
  });
});
