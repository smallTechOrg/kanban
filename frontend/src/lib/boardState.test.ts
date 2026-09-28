import { describe, expect, it } from 'vitest';
import {
  applyArchive,
  applyArchiveList,
  applyCardPatch,
  applyCardRow,
  applyCreate,
  applyCreateList,
  applyListMove,
  applyListPatch,
  applyListPositions,
  applyListRow,
  applyMemberRow,
  applyMove,
  applyPositions,
  applyRemoveCard,
  applyRemoveList,
  applyUnarchive,
  applyUnarchiveList,
  byPosition,
  clientIdFromUuid,
  draftCard,
  draftList,
  findCardByClientId,
  isId,
  isTempId,
  nextTempId,
  selectActiveCardCount,
  selectBoardMeta,
  selectCard,
  selectCards,
  selectLabels,
  selectList,
  selectListOrder,
  selectMatchedCardCount,
  selectMembers,
  setBoardVersion,
  swapTempId,
  TEMP_ID_PREFIX,
  type BoardMeta,
  type BoardState,
  type CardRow,
  type Id,
  type LabelRow,
  type ListRow,
  type MemberRow,
} from './boardState';

const STEP = 65536;

const board: BoardMeta = {
  id: 7,
  name: 'Website relaunch',
  description: '',
  version: 10,
  owner_id: 1,
  background_type: 'color',
  background_value: 'var(--primary)',
  background_thumb_url: null,
  visibility: 'private',
  is_closed: false,
  is_starred: false,
  my_role: 'admin',
  created_at: '2026-09-01T09:12:00.000Z',
  updated_at: '2026-09-24T17:58:41.120Z',
};

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
    member_ids: [],
    is_watching: false,
    badges: {
      description: false,
      comments: 0,
      attachments: 0,
      checklist_done: 0,
      checklist_total: 0,
    },
    created_at: '2026-09-03T11:00:00.000Z',
    updated_at: '2026-09-03T11:00:00.000Z',
    ...overrides,
  };
}

const label: LabelRow = {
  id: 31,
  board_id: 7,
  name: '',
  color: 'green',
  tone: 'normal',
  position: STEP,
};
const member: MemberRow = {
  id: 1,
  username: 'vivek',
  full_name: 'Vivek Sharma',
  initials: 'VS',
  avatar_color: 'var(--logo)',
  role: 'admin',
  joined_at: '2026-09-01T09:12:00.000Z',
};

/** `[A, B, C]` in list 11 and `[X]` in list 12 — the board every reducer test starts from. */
function makeState(): BoardState {
  const todo = makeList({ id: 11 });
  const doing = makeList({ id: 12, name: 'Doing', position: 2 * STEP });
  const cards = [
    makeCard({ id: 101, title: 'A', position: STEP }),
    makeCard({ id: 102, title: 'B', position: 2 * STEP }),
    makeCard({ id: 103, title: 'C', position: 3 * STEP }),
    makeCard({ id: 201, title: 'X', list_id: 12, position: STEP }),
  ];
  return {
    board,
    lists: { 11: todo, 12: doing },
    cards: Object.fromEntries(cards.map((card) => [card.id, card])),
    labels: { 31: label },
    members: { 1: member },
    listOrder: [11, 12],
    cardOrder: { 11: [101, 102, 103], 12: [201] },
  };
}

describe('isId', () => {
  it('accepts an id and rejects what a route param can otherwise hold', () => {
    expect(isId(1)).toBe(true);
    expect(isId(12)).toBe(true);
    expect(isId(0)).toBe(false);
    expect(isId(-3)).toBe(false);
    expect(isId(1.5)).toBe(false);
    expect(isId(Number.NaN)).toBe(false);
  });
});

describe('ordering helpers', () => {
  it('sorts by position and breaks a tie on id', () => {
    expect(byPosition({ id: 2, position: 1 }, { id: 3, position: 2 })).toBeLessThan(0);
    expect(byPosition({ id: 9, position: 1 }, { id: 3, position: 1 })).toBeGreaterThan(0);
  });

  it('recognises an optimistic id and builds a client id from a uuid', () => {
    expect(isTempId(-1)).toBe(true);
    expect(isTempId(12)).toBe(false);
    expect(clientIdFromUuid('0b0cb7fa-6f4a-4f1c-9c4a-3f0b6f2f8a11')).toBe(
      `${TEMP_ID_PREFIX}0b0cb7fa6f4a4f1c9c4a3f0b6f2f8a11`,
    );
    expect(clientIdFromUuid('0b0cb7fa-6f4a-4f1c-9c4a-3f0b6f2f8a11')).toHaveLength(36);
  });

  it('mints a fresh optimistic id on every call, always negative and descending', () => {
    const first = nextTempId();
    const second = nextTempId();

    expect(isTempId(first)).toBe(true);
    expect(second).toBeLessThan(first);
  });
});

describe('selectors', () => {
  it('reads the board, its lists and its cards', () => {
    const state = makeState();
    expect(selectBoardMeta(state)).toBe(state.board);
    expect(selectListOrder(state)).toEqual([11, 12]);
    expect(selectList(state, 11)?.name).toBe('To Do');
    expect(selectList(state, 99)).toBeUndefined();
    expect(selectCard(state, 102)?.title).toBe('B');
    expect(selectCards(state, 11).map((card) => card.id)).toEqual([101, 102, 103]);
    expect(selectCards(state, 12).map((card) => card.title)).toEqual(['X']);
    expect(selectCards(state, 99)).toEqual([]);
    expect(selectActiveCardCount(state, 11)).toBe(3);
    expect(selectActiveCardCount(state, 99)).toBe(0);
    expect(selectLabels(state)).toEqual([label]);
    expect(selectMembers(state)).toEqual([member]);
  });

  it('counts the cards a filter leaves, and answers undefined while none is active', () => {
    const state = makeState();

    // Section 2.4.2: "matched/total" while a filter is active, the total alone otherwise.
    expect(selectMatchedCardCount(state, 11, (card) => card.title !== 'B')).toBe(2);
    expect(selectMatchedCardCount(state, 11, () => false)).toBe(0);
    expect(selectMatchedCardCount(state, 99, () => true)).toBe(0);
    expect(selectMatchedCardCount(state, 11, null)).toBeUndefined();
  });

  it('drops an order id whose row has gone', () => {
    const state = makeState();
    const dangling: BoardState = { ...state, cardOrder: { ...state.cardOrder, 11: [101, 999] } };
    expect(selectCards(dangling, 11).map((card) => card.id)).toEqual([101]);
  });

  it('finds a card by the client id the server echoed', () => {
    const state = makeState();
    const withClientId = applyCardRow(
      state,
      makeCard({ id: 104, client_id: 'tmp_abc', position: 4 * STEP }),
    );
    expect(findCardByClientId(withClientId, 'tmp_abc')?.id).toBe(104);
    expect(findCardByClientId(withClientId, 'tmp_missing')).toBeUndefined();
  });
});

describe('applyMove', () => {
  it('splices a card down its own list', () => {
    const moved = applyMove(makeState(), { cardId: 101, toListId: 11, index: 1 });
    expect(moved.cardOrder[11]).toEqual([102, 101, 103]);
  });

  it('moves a card into another list and retargets the row', () => {
    const moved = applyMove(makeState(), { cardId: 101, toListId: 12, index: 0 });
    expect(moved.cardOrder[11]).toEqual([102, 103]);
    expect(moved.cardOrder[12]).toEqual([101, 201]);
    expect(selectCard(moved, 101)?.list_id).toBe(12);
  });

  it('clamps an index beyond the end and starts an unknown list', () => {
    const moved = applyMove(makeState(), { cardId: 101, toListId: 42, index: 9 });
    expect(moved.cardOrder[42]).toEqual([101]);
  });

  it('leaves the state alone for an unknown card', () => {
    const state = makeState();
    expect(applyMove(state, { cardId: 999, toListId: 11, index: 0 })).toBe(state);
  });
});

describe('create, swap and remove', () => {
  const draft = draftCard({
    id: -1,
    clientId: 'tmp_one',
    boardId: 7,
    listId: 11,
    title: 'Draft',
    now: '2026-09-26T10:00:00.000Z',
  });

  it('builds a draft card with and without tokens', () => {
    expect(draft.position).toBe(0);
    expect(draft.label_ids).toEqual([]);
    const tokenised = draftCard({
      id: -2,
      clientId: 'tmp_two',
      boardId: 7,
      listId: 11,
      title: 'Draft',
      labelIds: [31],
      memberIds: [1],
      now: '2026-09-26T10:00:00.000Z',
    });
    expect(tokenised.label_ids).toEqual([31]);
    expect(tokenised.member_ids).toEqual([1]);
  });

  it('inserts at the top, the bottom, a slot and by default', () => {
    const state = makeState();
    expect(applyCreate(state, { card: draft, index: 'top' }).cardOrder[11]).toEqual([
      -1, 101, 102, 103,
    ]);
    expect(applyCreate(state, { card: draft, index: 'bottom' }).cardOrder[11]).toEqual([
      101, 102, 103, -1,
    ]);
    expect(applyCreate(state, { card: draft, index: 1 }).cardOrder[11]).toEqual([
      101, -1, 102, 103,
    ]);
    expect(applyCreate(state, { card: draft }).cardOrder[11]).toEqual([101, 102, 103, -1]);
  });

  it('swaps the temporary id for the server row and keeps the client id', () => {
    const optimistic = applyCreate(makeState(), { card: draft, index: 'top' });
    const swapped = swapTempId(
      optimistic,
      -1,
      makeCard({ id: 104, client_id: 'tmp_one', title: 'Draft', position: STEP / 2 }),
    );
    expect(swapped.cards[-1]).toBeUndefined();
    expect(swapped.cardOrder[11]).toEqual([104, 101, 102, 103]);
    expect(selectCard(swapped, 104)?.client_id).toBe('tmp_one');
  });

  it('removes a card, and ignores one that is not there', () => {
    const state = applyCreate(makeState(), { card: draft, index: 'top' });
    const rolled = applyRemoveCard(state, -1);
    expect(rolled.cardOrder[11]).toEqual([101, 102, 103]);
    expect(applyRemoveCard(rolled, -1)).toBe(rolled);
  });
});

describe('server merges', () => {
  it('writes a card row into its sorted slot', () => {
    const merged = applyCardRow(
      makeState(),
      makeCard({ id: 102, title: 'B moved', position: 4 * STEP }),
    );
    expect(merged.cardOrder[11]).toEqual([101, 103, 102]);
    expect(selectCard(merged, 102)?.title).toBe('B moved');
  });

  it('moves a card row between lists and keeps an archived row out of the order', () => {
    const across = applyCardRow(
      makeState(),
      makeCard({ id: 101, list_id: 12, position: 2 * STEP }),
    );
    expect(across.cardOrder[11]).toEqual([102, 103]);
    expect(across.cardOrder[12]).toEqual([201, 101]);

    const archived = applyCardRow(across, makeCard({ id: 101, list_id: 12, is_archived: true }));
    expect(archived.cardOrder[12]).toEqual([201]);
    expect(selectCard(archived, 101)?.is_archived).toBe(true);
  });

  it('starts an order for a card that arrives for a list this client has not seen', () => {
    const merged = applyCardRow(makeState(), makeCard({ id: 301, list_id: 99 }));
    expect(merged.cardOrder[99]).toEqual([301]);
  });

  it('writes a list row, and keeps an archived one off the canvas', () => {
    const renamed = applyListRow(
      makeState(),
      makeList({ id: 12, name: 'In progress', position: 2 * STEP }),
    );
    expect(renamed.listOrder).toEqual([11, 12]);
    expect(selectList(renamed, 12)?.name).toBe('In progress');

    const archived = applyListRow(renamed, makeList({ id: 12, is_archived: true }));
    expect(archived.listOrder).toEqual([11]);
  });

  it('writes a member row for both an added member and a changed role', () => {
    const added = applyMemberRow(makeState(), { ...member, id: 2, full_name: 'Asha Patel' });
    expect(selectMembers(added).map((row) => row.id)).toEqual([1, 2]);

    const demoted = applyMemberRow(added, { ...member, id: 2, role: 'observer' });
    expect(selectMembers(demoted).map((row) => row.role)).toEqual(['admin', 'observer']);
    expect(selectMembers(makeState())).toEqual([member]);
  });

  it('writes a positions map and re-sorts the lists it touched', () => {
    const state = makeState();
    const renumbered = applyPositions(state, { '101': 4 * STEP, '999': STEP });
    expect(renumbered.cardOrder[11]).toEqual([102, 103, 101]);
    expect(applyPositions(state, { '999': STEP })).toBe(state);
  });

  it('sorts an order that still holds an id without a row', () => {
    const state = makeState();
    const dangling: BoardState = {
      ...state,
      cardOrder: { ...state.cardOrder, 11: [999, 101, 102, 103] },
    };
    expect(applyPositions(dangling, { '103': 0 }).cardOrder[11]).toEqual([103, 101, 102, 999]);
  });

  it('writes the list positions map of a list move', () => {
    const state = makeState();
    expect(applyListPositions(state, { '12': STEP / 2 }).listOrder).toEqual([12, 11]);
    expect(applyListPositions(state, { '999': STEP })).toBe(state);
  });

  it('gates the board version', () => {
    const state = makeState();
    expect(setBoardVersion(state, 11).board.version).toBe(11);
    expect(setBoardVersion(state, 10)).toBe(state);
  });
});

describe('archive and its rollback', () => {
  it('takes a card out of the order and puts it back in its slot', () => {
    const state = makeState();
    const archived = applyArchive(state, 102);
    expect(archived.cardOrder[11]).toEqual([101, 103]);
    expect(selectCard(archived, 102)?.is_archived).toBe(true);
    expect(applyArchive(archived, 102)).toBe(archived);
    expect(applyArchive(state, 999)).toBe(state);

    const restored = applyUnarchive(archived, 102);
    expect(restored.cardOrder[11]).toEqual([101, 102, 103]);
    expect(applyUnarchive(restored, 102)).toBe(restored);
    expect(applyUnarchive(state, 999)).toBe(state);
  });

  it('archives and restores a list', () => {
    const state = makeState();
    const archived = applyArchiveList(state, 12);
    expect(archived.listOrder).toEqual([11]);
    expect(applyArchiveList(archived, 12)).toBe(archived);
    expect(applyArchiveList(state, 999)).toBe(state);

    const restored = applyUnarchiveList(archived, 12);
    expect(restored.listOrder).toEqual([11, 12]);
    expect(applyUnarchiveList(restored, 12)).toBe(restored);
    expect(applyUnarchiveList(state, 999)).toBe(state);
  });
});

describe('inline edits', () => {
  it('patches a card title and a list name', () => {
    const state = makeState();
    expect(selectCard(applyCardPatch(state, 101, { title: 'Renamed' }), 101)?.title).toBe(
      'Renamed',
    );
    expect(applyCardPatch(state, 999, { title: 'x' })).toBe(state);
    expect(selectList(applyListPatch(state, 11, { color: 'blue' }), 11)?.color).toBe('blue');
    expect(applyListPatch(state, 999, { name: 'x' })).toBe(state);
  });
});

describe('list reducers', () => {
  it('splices a list, and ignores an unknown one', () => {
    const state = makeState();
    expect(applyListMove(state, { listId: 12, index: 0 }).listOrder).toEqual([12, 11]);
    expect(applyListMove(state, { listId: 999, index: 0 })).toBe(state);
  });

  it('creates a list at the end and rolls it back with its cards', () => {
    const state = makeState();
    const list = draftList({ id: -5, boardId: 7, name: 'Done', now: '2026-09-26T10:00:00.000Z' });
    expect(list.position).toBe(0);
    const created = applyCreateList(state, { list });
    expect(created.listOrder).toEqual([11, 12, -5]);
    expect(created.cardOrder[-5]).toEqual([]);

    const rolled = applyRemoveList(created, -5);
    expect(rolled.listOrder).toEqual([11, 12]);
    expect(applyRemoveList(rolled, -5)).toBe(rolled);
  });

  it('deletes a list with every card it held', () => {
    const deleted = applyRemoveList(makeState(), 11);
    expect(deleted.listOrder).toEqual([12]);
    expect(deleted.cardOrder[11]).toBeUndefined();
    expect(Object.keys(deleted.cards)).toEqual(['201']);
  });

  it('creates a list at a slot', () => {
    const list = draftList({
      id: -6,
      boardId: 7,
      name: 'Backlog',
      now: '2026-09-26T10:00:00.000Z',
    });
    expect(applyCreateList(makeState(), { list, index: 0 }).listOrder).toEqual([-6, 11, 12]);
  });
});
