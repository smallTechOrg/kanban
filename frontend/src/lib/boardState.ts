/**
 * The normalised board cache and every pure reducer that changes it (Section 5.4.2).
 *
 * `['board', boardId]` holds a `BoardState`: three id maps plus the two order arrays the
 * canvas renders. Section 5.4.3 writes its optimistic updates as "splice id out of
 * `cardOrder[from]`, into `cardOrder[to]`", so the cache holds this shape and not the raw
 * payload — an optimistic splice cannot survive a round trip through the payload arrays,
 * whose only order is `(position, id)` and whose positions the client is never allowed to
 * compute. `lib/normalize.ts` converts the payload into this shape and back.
 *
 * The row types are written out here rather than imported from `api/types.ts` for the two
 * reasons Section 5.4.2 states itself: that file is generated from OpenAPI, and `lib/` sits
 * below `api/` in the layering (CLAUDE.md section 2). They mirror the server's rows field for
 * field and keep its `snake_case` names, so a payload row *is* a cache row.
 *
 * Every function here is pure: it returns a new state and never mutates its argument. The
 * client never computes a `position`; a reducer only ever reorders ids, and the authoritative
 * `position` arrives with the server's response (`applyCardRow`, `applyPositions`).
 */

export type Id = number;

/**
 * Whether a number is usable as an id: `int >= 1` (Section 4.1).
 *
 * `/b/:boardId` and `/b/:boardId/c/:cardId` are typed by nobody, so `Number(params.boardId)`
 * can be `NaN`, `0` or `1.5`. Both routes answer such a URL with the 404 page and neither
 * query is ever sent, which is one rule, so it is written here once for both ids.
 */
export function isId(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

export type BackgroundKind = 'color' | 'gradient' | 'image';
export type CoverKind = 'color' | 'attachment';
export type CoverSize = 'normal' | 'full';
export type LabelTone = 'subtle' | 'normal' | 'bold';

/** The board row of the payload, as `BoardHeader` and the About panel read it. */
export interface BoardMeta {
  id: Id;
  name: string;
  description: string;
  version: number;
  background_type: BackgroundKind;
  background_value: string;
  background_thumb_url: string | null;
  is_closed: boolean;
  is_starred: boolean;
  created_at: string;
  updated_at: string;
}

export interface ListRow {
  id: Id;
  board_id: Id;
  name: string;
  position: number;
  /** A `list_colors` key from `GET /api/meta`, or `null` for the default grey column. */
  color: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface CoverRow {
  kind: CoverKind;
  value: string;
  size: CoverSize;
  image_url?: string;
  dominant_color?: string;
}

export interface BadgeCounts {
  description: boolean;
  attachments: number;
  checklist_done: number;
  checklist_total: number;
}

export interface CardRow {
  id: Id;
  /**
   * `'tmp_' + 32 hex chars`, minted by the optimistic insert and then echoed by the server in
   * every `CardSummary` of this card, so `client_id ?? id` is a stable React key across the
   * id swap and every later refetch (Sections 4.4 and 5.4.2).
   */
  client_id?: string;
  board_id: Id;
  list_id: Id;
  short_id: number;
  title: string;
  position: number;
  is_archived: boolean;
  is_template: boolean;
  start_at: string | null;
  due_at: string | null;
  due_complete: boolean;
  cover: CoverRow | null;
  label_ids: Id[];
  badges: BadgeCounts;
  created_at: string;
  /** Drives the Filter popover's Activity section (Section 2.3.3). */
  updated_at: string;
}

export interface LabelRow {
  id: Id;
  board_id: Id;
  name: string;
  /** A `label_colors` key from `GET /api/meta`, including `none` (Section 2.9.2). */
  color: string;
  tone: LabelTone;
  position: number;
}

/** The board document as `GET /api/boards/{board_id}` returns it (Section 4.10.1). */
export interface BoardDocument {
  board: BoardMeta;
  labels: LabelRow[];
  lists: ListRow[];
  cards: CardRow[];
}

export interface BoardState {
  board: BoardMeta;
  lists: Record<Id, ListRow>;
  cards: Record<Id, CardRow>;
  labels: Record<Id, LabelRow>;
  /** Active lists sorted by `(position, id)`. */
  listOrder: Id[];
  /** `listId -> active card ids sorted by (position, id)`. */
  cardOrder: Record<Id, Id[]>;
}

/** Where a new card or list goes: a 0-based slot, or Trello's `top` / `bottom` (Section 4.4). */
export type SlotIndex = number | 'top' | 'bottom';

/** The `cards.client_id` prefix the server validates as `^tmp_[A-Za-z0-9]{1,32}$`. */
export const TEMP_ID_PREFIX = 'tmp_';

const EMPTY_IDS: readonly Id[] = [];

/** Optimistic rows carry a negative id until the server answers with the real one. */
export function isTempId(id: Id): boolean {
  return id < 0;
}

/**
 * The next optimistic id: ids count down, so two rows minted in the same millisecond cannot
 * collide. One counter serves every id space — cards, lists, labels, checklists and items —
 * because `isTempId` above recognises all of them by the same sign, and two counters (one per
 * mutation hook) were the same rule written twice (CLAUDE.md section 3).
 */
export function nextTempId(): Id {
  lastTempId = Math.min(-Date.now(), lastTempId - 1);
  return lastTempId;
}

let lastTempId = 0;

/** `'tmp_' + 32 hex chars` from a `crypto.randomUUID()` value (Sections 2.4.4 and 5.4.3). */
export function clientIdFromUuid(uuid: string): string {
  return `${TEMP_ID_PREFIX}${uuid.replace(/-/g, '')}`;
}

/** The one ordering rule of the whole client: `ORDER BY position ASC, id ASC` (Section 4.9). */
export function byPosition(
  a: { position: number; id: Id },
  b: { position: number; id: Id },
): number {
  return a.position === b.position ? a.id - b.id : a.position - b.position;
}

function sortRows<T extends { position: number; id: Id }>(rows: readonly T[]): T[] {
  return [...rows].sort(byPosition);
}

/** Sorts ids by their rows' `(position, id)`; an id without a row keeps its place at the end. */
function sortIds(ids: readonly Id[], rows: Record<Id, { position: number; id: Id }>): Id[] {
  const known: { position: number; id: Id }[] = [];
  const unknown: Id[] = [];
  for (const id of ids) {
    const row = rows[id];
    if (row === undefined) unknown.push(id);
    else known.push(row);
  }
  return [...sortRows(known).map((row) => row.id), ...unknown];
}

function withoutId(ids: readonly Id[], id: Id): Id[] {
  return ids.filter((candidate) => candidate !== id);
}

/** Inserts `id` at `index`, clamped to `[0, ids.length]`; `top` is 0 and `bottom` the end. */
function insertAt(ids: readonly Id[], id: Id, index: SlotIndex | undefined): Id[] {
  const next = [...ids];
  if (index === 'top') next.unshift(id);
  else if (index === undefined || index === 'bottom') next.push(id);
  else next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
  return next;
}

function cardIds(state: BoardState, listId: Id): readonly Id[] {
  return state.cardOrder[listId] ?? EMPTY_IDS;
}

function withCardOrder(state: BoardState, listId: Id, ids: readonly Id[]): BoardState {
  return { ...state, cardOrder: { ...state.cardOrder, [listId]: [...ids] } };
}

// ---------------------------------------------------------------------------- selectors

export function selectBoardMeta(state: BoardState): BoardMeta {
  return state.board;
}

export function selectListOrder(state: BoardState): Id[] {
  return state.listOrder;
}

export function selectList(state: BoardState, listId: Id): ListRow | undefined {
  return state.lists[listId];
}

export function selectCard(state: BoardState, cardId: Id): CardRow | undefined {
  return state.cards[cardId];
}

/** One list's active cards, in `cardOrder`; an id whose row has gone is dropped. */
export function selectCards(state: BoardState, listId: Id): CardRow[] {
  const rows: CardRow[] = [];
  for (const id of cardIds(state, listId)) {
    const row = state.cards[id];
    if (row !== undefined) rows.push(row);
  }
  return rows;
}

/** What `^N` is clamped against in the composer: the list's active card count (Section 2.4.4). */
export function selectActiveCardCount(state: BoardState, listId: Id): number {
  return cardIds(state, listId).length;
}

/**
 * How many of a list's active cards survive the board filter, for the "matched/total" count of
 * Section 2.4.2 — or `undefined` when no filter is active and the header shows the total alone.
 *
 * It answers with the number rather than the rows because `ListColumn` needs nothing else from
 * them: a selector that returns a count leaves the column out of the re-render of every card
 * edit that does not change it, which is Section 5.11's "a single card change re-renders one
 * tile". The predicate is `hooks/useBoardFilter.ts`, the same one `CardList` hides a tile with,
 * so the header can never disagree with what the column shows.
 */
export function selectMatchedCardCount(
  state: BoardState,
  listId: Id,
  matches: ((card: CardRow) => boolean) | null,
): number | undefined {
  if (matches === null) return undefined;
  return selectCards(state, listId).filter(matches).length;
}

export function selectLabels(state: BoardState): LabelRow[] {
  return sortRows(Object.values(state.labels));
}

/** Finds the row the server echoed a `client_id` for, which is how a temp id is resolved. */
export function findCardByClientId(state: BoardState, clientId: string): CardRow | undefined {
  return Object.values(state.cards).find((card) => card.client_id === clientId);
}

// ---------------------------------------------------------------------------- server merges

/**
 * Writes an authoritative card row: the id map, then its slot in `cardOrder` re-sorted by the
 * server's `position`. An archived row stays in the map (Undo needs it) but leaves the order.
 */
export function applyCardRow(state: BoardState, card: CardRow): BoardState {
  const previous = state.cards[card.id];
  const cards = { ...state.cards, [card.id]: card };
  const cardOrder = { ...state.cardOrder };
  if (previous !== undefined) {
    cardOrder[previous.list_id] = withoutId(cardIds(state, previous.list_id), card.id);
  }
  const target = withoutId(cardOrder[card.list_id] ?? EMPTY_IDS, card.id);
  cardOrder[card.list_id] = card.is_archived ? target : sortIds([...target, card.id], cards);
  return { ...state, cards, cardOrder };
}

/** The same for a list row: the map, then its slot in `listOrder`. */
export function applyListRow(state: BoardState, list: ListRow): BoardState {
  const lists = { ...state.lists, [list.id]: list };
  const rest = withoutId(state.listOrder, list.id);
  const listOrder = list.is_archived ? rest : sortIds([...rest, list.id], lists);
  return {
    ...state,
    lists,
    listOrder,
    cardOrder: { ...state.cardOrder, [list.id]: [...cardIds(state, list.id)] },
  };
}

/**
 * Writes a `positions` map of card ids (`MoveResult`, `sort`, `move-all-cards`; Section 4.9)
 * and re-sorts every list it touched. An unknown id is ignored: it belongs to a list this
 * client has not loaded.
 */
export function applyPositions(
  state: BoardState,
  positions: Readonly<Record<string, number>>,
): BoardState {
  const cards = { ...state.cards };
  const touched = new Set<Id>();
  for (const [key, position] of Object.entries(positions)) {
    const id = Number(key);
    const card = cards[id];
    if (card === undefined) continue;
    cards[id] = { ...card, position };
    touched.add(card.list_id);
  }
  if (touched.size === 0) return state;
  const cardOrder = { ...state.cardOrder };
  for (const listId of touched) cardOrder[listId] = sortIds(cardIds(state, listId), cards);
  return { ...state, cards, cardOrder };
}

/** The list form of `applyPositions`: the `positions` map of `POST /api/lists/{id}/move`. */
export function applyListPositions(
  state: BoardState,
  positions: Readonly<Record<string, number>>,
): BoardState {
  const lists = { ...state.lists };
  let changed = false;
  for (const [key, position] of Object.entries(positions)) {
    const id = Number(key);
    const list = lists[id];
    if (list === undefined) continue;
    lists[id] = { ...list, position };
    changed = true;
  }
  if (!changed) return state;
  return { ...state, lists, listOrder: sortIds(state.listOrder, lists) };
}

/**
 * The version gate of Section 5.4.3: a response whose version is not newer than the cached
 * one is ignored, so two responses landing out of order cannot walk the board backwards.
 */
export function setBoardVersion(state: BoardState, version: number): BoardState {
  if (version <= state.board.version) return state;
  return { ...state, board: { ...state.board, version } };
}

// ---------------------------------------------------------------------------- card reducers

export interface CardMoveInput {
  cardId: Id;
  toListId: Id;
  index: number;
}

/** `onDragEnd`'s optimistic splice: out of the source order, into the destination at `index`. */
export function applyMove(
  state: BoardState,
  { cardId, toListId, index }: CardMoveInput,
): BoardState {
  const card = state.cards[cardId];
  if (card === undefined) return state;
  const cardOrder = { ...state.cardOrder };
  cardOrder[card.list_id] = withoutId(cardIds(state, card.list_id), cardId);
  cardOrder[toListId] = insertAt(
    withoutId(cardOrder[toListId] ?? EMPTY_IDS, cardId),
    cardId,
    index,
  );
  return {
    ...state,
    cards: { ...state.cards, [cardId]: { ...card, list_id: toListId } },
    cardOrder,
  };
}

export interface DraftCardInput {
  id: Id;
  clientId: string;
  boardId: Id;
  listId: Id;
  title: string;
  labelIds?: readonly Id[];
  now: string;
}

/**
 * The tile the composer shows before the server answers. `position` is 0 — a placeholder the
 * create response overwrites, never an ordering decision: the row's slot comes from the
 * `index` the reducer splices it at.
 */
export function draftCard(input: DraftCardInput): CardRow {
  return {
    id: input.id,
    client_id: input.clientId,
    board_id: input.boardId,
    list_id: input.listId,
    short_id: 0,
    title: input.title,
    position: 0,
    is_archived: false,
    is_template: false,
    start_at: null,
    due_at: null,
    due_complete: false,
    cover: null,
    label_ids: [...(input.labelIds ?? [])],
    badges: {
      description: false,
      attachments: 0,
      checklist_done: 0,
      checklist_total: 0,
    },
    created_at: input.now,
    updated_at: input.now,
  };
}

export interface CreateCardInput {
  card: CardRow;
  index?: SlotIndex;
}

/** Inserts an optimistic card at `index` (`top` / `bottom` / a 0-based slot). */
export function applyCreate(state: BoardState, { card, index }: CreateCardInput): BoardState {
  return {
    ...state,
    cards: { ...state.cards, [card.id]: card },
    cardOrder: {
      ...state.cardOrder,
      [card.list_id]: insertAt(cardIds(state, card.list_id), card.id, index),
    },
  };
}

/** Rollback of `applyCreate`, and the row `swapTempId` takes out before the server's goes in. */
export function applyRemoveCard(state: BoardState, cardId: Id): BoardState {
  const card = state.cards[cardId];
  if (card === undefined) return state;
  const cards = { ...state.cards };
  delete cards[cardId];
  return withCardOrder(
    { ...state, cards },
    card.list_id,
    withoutId(cardIds(state, card.list_id), cardId),
  );
}

/**
 * The id swap: the temp row leaves the cache and the server's row takes its slot. The row
 * keeps the `client_id` the server echoed, so the tile's key never changes (Section 5.4.2).
 */
export function swapTempId(state: BoardState, tempId: Id, card: CardRow): BoardState {
  return applyCardRow(applyRemoveCard(state, tempId), card);
}

/** `POST /api/cards/{card_id}/archive`: out of the order, `is_archived` set, row kept for Undo. */
export function applyArchive(state: BoardState, cardId: Id): BoardState {
  const card = state.cards[cardId];
  if (card === undefined || card.is_archived) return state;
  return withCardOrder(
    { ...state, cards: { ...state.cards, [cardId]: { ...card, is_archived: true } } },
    card.list_id,
    withoutId(cardIds(state, card.list_id), cardId),
  );
}

/** The Undo of `applyArchive`: back into its own slot, because an archived row keeps `position`. */
export function applyUnarchive(state: BoardState, cardId: Id): BoardState {
  const card = state.cards[cardId];
  if (card === undefined || !card.is_archived) return state;
  return applyCardRow(state, { ...card, is_archived: false });
}

/** A field write from an inline edit; the server's row replaces it in `onSuccess`. */
export function applyCardPatch(state: BoardState, cardId: Id, patch: Partial<CardRow>): BoardState {
  const card = state.cards[cardId];
  if (card === undefined) return state;
  return applyCardRow(state, { ...card, ...patch, id: card.id });
}

// ---------------------------------------------------------------------------- list reducers

export interface ListMoveInput {
  listId: Id;
  index: number;
}

/** The horizontal drag: one splice in `listOrder`. */
export function applyListMove(state: BoardState, { listId, index }: ListMoveInput): BoardState {
  if (state.lists[listId] === undefined) return state;
  return { ...state, listOrder: insertAt(withoutId(state.listOrder, listId), listId, index) };
}

export interface DraftListInput {
  id: Id;
  boardId: Id;
  name: string;
  now: string;
}

/** The optimistic column `AddListComposer` shows; `position` comes back with the response. */
export function draftList(input: DraftListInput): ListRow {
  return {
    id: input.id,
    board_id: input.boardId,
    name: input.name,
    position: 0,
    color: null,
    is_archived: false,
    created_at: input.now,
    updated_at: input.now,
  };
}

export interface CreateListInput {
  list: ListRow;
  index?: SlotIndex;
}

export function applyCreateList(state: BoardState, { list, index }: CreateListInput): BoardState {
  return {
    ...state,
    lists: { ...state.lists, [list.id]: list },
    cardOrder: { ...state.cardOrder, [list.id]: [] },
    listOrder: insertAt(state.listOrder, list.id, index),
  };
}

/** Rollback of `applyCreateList`, and the optimistic half of `DELETE /api/lists/{list_id}`. */
export function applyRemoveList(state: BoardState, listId: Id): BoardState {
  const list = state.lists[listId];
  if (list === undefined) return state;
  const lists = { ...state.lists };
  const cardOrder = { ...state.cardOrder };
  const cards = { ...state.cards };
  delete lists[listId];
  delete cardOrder[listId];
  for (const card of Object.values(state.cards)) {
    if (card.list_id === listId) delete cards[card.id];
  }
  return { ...state, lists, cards, cardOrder, listOrder: withoutId(state.listOrder, listId) };
}

/** `POST /api/lists/{list_id}/archive`: the column leaves the canvas with its cards. */
export function applyArchiveList(state: BoardState, listId: Id): BoardState {
  const list = state.lists[listId];
  if (list === undefined || list.is_archived) return state;
  return {
    ...state,
    lists: { ...state.lists, [listId]: { ...list, is_archived: true } },
    listOrder: withoutId(state.listOrder, listId),
  };
}

/** "Send to board": the column returns to its stored slot (an archived row keeps `position`). */
export function applyUnarchiveList(state: BoardState, listId: Id): BoardState {
  const list = state.lists[listId];
  if (list === undefined || !list.is_archived) return state;
  return applyListRow(state, { ...list, is_archived: false });
}

export function applyListPatch(state: BoardState, listId: Id, patch: Partial<ListRow>): BoardState {
  const list = state.lists[listId];
  if (list === undefined) return state;
  return applyListRow(state, { ...list, ...patch, id: list.id });
}
