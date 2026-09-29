import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER,
  activeFilterCount,
  filterFromSearchParams,
  filterToSearchParams,
  isFilterActive,
  matchesFilter,
  type BoardFilter,
  type FilterCard,
  type FilterContext,
} from './filter';

const NOW = new Date('2026-09-25T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function at(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

function card(overrides: Partial<FilterCard> = {}): FilterCard {
  return {
    title: 'Write launch announcement',
    label_ids: [],
    due_at: null,
    due_complete: false,
    is_template: false,
    updated_at: at(-DAY_MS),
    ...overrides,
  };
}

const CONTEXT: FilterContext = {
  now: NOW,
  labelsById: { 31: { name: 'Bug fix' }, 32: { name: '' } },
};

function filter(overrides: Partial<BoardFilter> = {}): BoardFilter {
  return { ...EMPTY_FILTER, ...overrides };
}

function matches(
  cardOverrides: Partial<FilterCard>,
  filterOverrides: Partial<BoardFilter>,
): boolean {
  return matchesFilter(card(cardOverrides), filter(filterOverrides), CONTEXT);
}

describe('matchesFilter', () => {
  it('passes every card when nothing is selected', () => {
    expect(matches({}, {})).toBe(true);
    // The Match select on its own is not a criterion.
    expect(matches({}, { match: 'all' })).toBe(true);
  });

  it('matches the keyword against the title and its label names', () => {
    expect(matches({}, { q: '  LAUNCH ' })).toBe(true);
    expect(matches({ label_ids: [31, 99] }, { q: 'bug' })).toBe(true);
    expect(matches({ label_ids: [32] }, { q: 'design' })).toBe(false);
    expect(matches({}, { q: 'design' })).toBe(false);
  });

  it('matches the labels group by "No labels" and by label id', () => {
    expect(matches({}, { noLabels: true })).toBe(true);
    expect(matches({ label_ids: [31] }, { noLabels: true })).toBe(false);
    expect(matches({ label_ids: [31] }, { labelIds: [31] })).toBe(true);
    expect(matches({ label_ids: [32] }, { labelIds: [31] })).toBe(false);
  });

  it('matches the card status, and never matches it for a template', () => {
    expect(matches({ due_complete: true }, { status: 'complete' })).toBe(true);
    expect(matches({ due_complete: false }, { status: 'complete' })).toBe(false);
    expect(matches({ due_complete: false }, { status: 'incomplete' })).toBe(true);
    expect(matches({ due_complete: true, is_template: true }, { status: 'complete' })).toBe(false);
  });

  it('matches "No dates", "Overdue" and the three windows', () => {
    expect(matches({}, { due: 'none' })).toBe(true);
    expect(matches({ due_at: at(DAY_MS) }, { due: 'none' })).toBe(false);

    expect(matches({ due_at: at(-DAY_MS) }, { due: 'overdue' })).toBe(true);
    expect(matches({ due_at: at(-DAY_MS), due_complete: true }, { due: 'overdue' })).toBe(false);

    expect(matches({ due_at: at(DAY_MS / 2) }, { due: 'day' })).toBe(true);
    expect(matches({ due_at: at(2 * DAY_MS) }, { due: 'day' })).toBe(false);
    expect(matches({ due_at: at(2 * DAY_MS) }, { due: 'week' })).toBe(true);
    expect(matches({ due_at: at(20 * DAY_MS) }, { due: 'month' })).toBe(true);
    // An overdue card is inside every window, and a completed one is inside none.
    expect(matches({ due_at: at(-5 * DAY_MS) }, { due: 'week' })).toBe(true);
    expect(matches({ due_at: at(DAY_MS / 2), due_complete: true }, { due: 'day' })).toBe(false);
    expect(matches({ due_at: null }, { due: 'week' })).toBe(false);
    expect(matches({ due_at: 'not a date' }, { due: 'week' })).toBe(false);
    expect(matches({ due_at: at(DAY_MS / 2), is_template: true }, { due: 'day' })).toBe(false);
  });

  it('matches the activity windows from updated_at', () => {
    expect(matches({ updated_at: at(-2 * DAY_MS) }, { activity: 'week' })).toBe(true);
    expect(matches({ updated_at: at(-10 * DAY_MS) }, { activity: 'week' })).toBe(false);
    expect(matches({ updated_at: at(-10 * DAY_MS) }, { activity: '2weeks' })).toBe(true);
    expect(matches({ updated_at: at(-20 * DAY_MS) }, { activity: '4weeks' })).toBe(true);
    expect(matches({ updated_at: at(-40 * DAY_MS) }, { activity: 'inactive' })).toBe(true);
    expect(matches({ updated_at: at(-2 * DAY_MS) }, { activity: 'inactive' })).toBe(false);
    expect(matches({ updated_at: 'never' }, { activity: 'week' })).toBe(false);
  });

  it('ORs the selected groups in "Any match" and ANDs them in "Exact match"', () => {
    const labelled = { label_ids: [31], due_at: at(10 * DAY_MS) };
    const any: Partial<BoardFilter> = { labelIds: [31], due: 'overdue' };
    expect(matches(labelled, any)).toBe(true);
    expect(matches(labelled, { ...any, match: 'all' })).toBe(false);
    expect(matches({ ...labelled, due_at: at(-DAY_MS) }, { ...any, match: 'all' })).toBe(true);
  });
});

describe('activeFilterCount', () => {
  it('counts one per selection and ignores the Match select', () => {
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
    expect(activeFilterCount(filter({ match: 'all', q: '   ' }))).toBe(0);
    expect(
      activeFilterCount(
        filter({
          q: 'launch',
          noLabels: true,
          labelIds: [31, 32],
          status: 'complete',
          due: 'overdue',
          activity: 'week',
        }),
      ),
    ).toBe(7);
  });

  it('is what turns the header button into a pill', () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive(filter({ due: 'overdue' }))).toBe(true);
  });
});

describe('filterToSearchParams', () => {
  it('omits every key at its default', () => {
    expect(filterToSearchParams(EMPTY_FILTER).toString()).toBe('');
    expect(filterToSearchParams(filter({ q: '  ' })).toString()).toBe('');
  });

  it('writes the documented schema', () => {
    const params = filterToSearchParams(
      filter({
        q: ' launch ',
        labelIds: [1, 2],
        due: 'overdue',
        status: 'incomplete',
        activity: 'week',
        match: 'all',
      }),
    );
    expect(params.toString()).toBe(
      'q=launch&labels=1%2C2&status=incomplete&due=overdue&activity=week&match=all',
    );
  });

  it('writes "none" in the same key as the ids', () => {
    expect(filterToSearchParams(filter({ noLabels: true })).get('labels')).toBe('none');
    expect(filterToSearchParams(filter({ noLabels: true, labelIds: [2] })).get('labels')).toBe(
      'none,2',
    );
  });
});

describe('filterFromSearchParams', () => {
  it('reads an empty query string as the empty filter', () => {
    expect(filterFromSearchParams(new URLSearchParams())).toEqual(EMPTY_FILTER);
  });

  it('round-trips every field', () => {
    const original = filter({
      q: 'launch',
      labelIds: [1, 2],
      noLabels: true,
      status: 'complete',
      due: 'week',
      activity: 'inactive',
      match: 'all',
    });
    expect(filterFromSearchParams(filterToSearchParams(original))).toEqual(original);
  });

  it('drops tokens and values it cannot read', () => {
    const params = new URLSearchParams(
      'labels=none,2,2,abc,0&status=maybe&due=soon&activity=daily&match=any',
    );
    expect(filterFromSearchParams(params)).toEqual(filter({ labelIds: [2], noLabels: true }));
  });
});
