import { describe, expect, it } from 'vitest';
import { denormalizeBoard, normalizeBoard } from './normalize';
import type { BoardDocument, BoardMeta, CardRow, Id, LabelRow, ListRow } from './boardState';

const STEP = 65536;

const board: BoardMeta = {
  id: 7,
  name: 'Website relaunch',
  description: '',
  version: 143,
  background_type: 'color',
  background_value: 'var(--primary)',
  background_thumb_url: null,
  is_closed: false,
  is_starred: true,
  created_at: '2026-09-01T09:12:00.000Z',
  updated_at: '2026-09-24T17:58:41.120Z',
};

const labels: LabelRow[] = [
  { id: 32, board_id: 7, name: 'Bug', color: 'red', tone: 'normal', position: 4 * STEP },
  { id: 31, board_id: 7, name: '', color: 'green', tone: 'normal', position: STEP },
];

function makeList(overrides: Partial<ListRow> & { id: Id }): ListRow {
  return {
    board_id: 7,
    name: 'To Do',
    position: STEP,
    color: null,
    is_archived: false,
    created_at: '2026-09-01T09:12:00.000Z',
    updated_at: '2026-09-01T09:12:00.000Z',
    ...overrides,
  };
}

function makeCard(overrides: Partial<CardRow> & { id: Id }): CardRow {
  return {
    board_id: 7,
    list_id: 11,
    short_id: 1,
    title: 'A card',
    position: STEP,
    is_archived: false,
    is_template: false,
    start_at: null,
    due_at: null,
    due_complete: false,
    cover: null,
    label_ids: [],
    badges: {
      description: false,
      attachments: 0,
      checklist_done: 0,
      checklist_total: 0,
    },
    created_at: '2026-09-03T11:00:00.000Z',
    updated_at: '2026-09-03T11:00:00.000Z',
    ...overrides,
  };
}

/** The payload arrives in position order; these arrays are deliberately shuffled. */
function makePayload(): BoardDocument {
  return {
    board,
    labels,
    lists: [
      makeList({ id: 12, name: 'Doing', position: 2 * STEP }),
      makeList({ id: 11, position: STEP }),
    ],
    cards: [
      makeCard({ id: 103, title: 'C', position: 3 * STEP }),
      makeCard({ id: 101, title: 'A', position: STEP }),
      makeCard({ id: 102, title: 'B', position: STEP }),
      makeCard({ id: 201, title: 'X', list_id: 12, position: STEP }),
    ],
  };
}

describe('normalizeBoard', () => {
  it('builds the id maps and both order arrays sorted by (position, id)', () => {
    const state = normalizeBoard(makePayload());
    expect(state.board).toBe(board);
    expect(state.listOrder).toEqual([11, 12]);
    expect(state.cardOrder[11]).toEqual([101, 102, 103]);
    expect(state.cardOrder[12]).toEqual([201]);
    expect(state.cards[102]?.title).toBe('B');
    expect(state.labels[31]?.color).toBe('green');
  });

  it('gives every list an order entry, even an empty one', () => {
    const payload = makePayload();
    const state = normalizeBoard({ ...payload, cards: [] });
    expect(state.cardOrder).toEqual({ 11: [], 12: [] });
  });

  it('keeps an archived row out of the order arrays but in the maps', () => {
    const payload = makePayload();
    const state = normalizeBoard({
      ...payload,
      lists: [...payload.lists, makeList({ id: 13, is_archived: true, position: 3 * STEP })],
      cards: [...payload.cards, makeCard({ id: 104, is_archived: true, position: 4 * STEP })],
    });
    expect(state.listOrder).toEqual([11, 12]);
    expect(state.cardOrder[11]).toEqual([101, 102, 103]);
    expect(state.lists[13]?.is_archived).toBe(true);
    expect(state.cards[104]?.is_archived).toBe(true);
  });

  it('still orders a card whose list is not in the payload', () => {
    const payload = makePayload();
    const state = normalizeBoard({
      ...payload,
      cards: [...payload.cards, makeCard({ id: 301, list_id: 99, position: STEP })],
    });
    expect(state.cardOrder[99]).toEqual([301]);
  });
});

describe('denormalizeBoard', () => {
  it('is the inverse of the normaliser', () => {
    const state = normalizeBoard(makePayload());
    expect(normalizeBoard(denormalizeBoard(state))).toEqual(state);
  });

  it('answers with the arrays the server would have sent, in position order', () => {
    const document = denormalizeBoard(normalizeBoard(makePayload()));
    expect(document.lists.map((list) => list.id)).toEqual([11, 12]);
    expect(document.cards.map((card) => card.id)).toEqual([101, 102, 201, 103]);
    expect(document.labels.map((entry) => entry.id)).toEqual([31, 32]);
    expect(document.board).toBe(board);
  });
});
