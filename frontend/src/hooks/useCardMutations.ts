/**
 * Every write the card detail modal makes: labels, the card's items, the card's own scalar
 * fields, and the archive, restore and delete of Sections 2.6.4 and 4.5. All of them optimistic,
 * and all through one recipe, the same one `hooks/useBoardMutations.ts` uses for the board
 * (Section 5.4.3) with one addition that Section 5.4.3 states outright — "Card-modal mutations
 * write to both `['card', id]` and the matching `CardRow` in `['board', boardId]` so tile badges
 * update instantly":
 *
 * - `onMutate` cancels the in-flight card and board queries, snapshots both and splices the
 *   change into each of them with a pure reducer.
 * - `onError` puts both snapshots back and shows a red toast.
 * - `onSuccess` writes the authoritative row, the `positions` map and the `board_version` the
 *   server returned.
 * - `onSettled` refetches the activity feed (every write here records a row the feed shows, and
 *   no response carries feed entries) and, for the 204 deletes that carry no `board_version`,
 *   the board.
 *
 * The client never computes a `position`: a reducer only reorders rows, the move endpoint is
 * sent the `index` the drop produced, and the authoritative positions arrive with the response.
 *
 * The badge counts are not read back from the server either, except where the server volunteers
 * them: `PATCH /api/card-items/{item_id}` answers with the card's recomputed `badges`
 * (Section 4.6) and that object wins, while the optimistic pass derives `item_done` /
 * `item_total` from the detail's own items through `lib/badges.ts`. The tile also *lists* those
 * items (Section 2.5.1), so every item write copies the patched array onto the board row in
 * the same step — `syncItems`, the one place the two caches are reconciled.
 */
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  archiveCard,
  deleteCard,
  unarchiveCard,
  updateCard,
  type UpdateCardInput,
} from '@/api/cards';
import {
  createItem,
  createItems,
  deleteItem,
  moveItem,
  updateItem,
  type UpdateItemInput,
} from '@/api/items';
import {
  attachLabel,
  createLabel,
  deleteLabel,
  detachLabel,
  updateLabel,
  type CreateLabelInput,
  type UpdateLabelInput,
} from '@/api/labels';
import type {
  CardDetail,
  CardItem,
  CardItemPatched,
  CardLabels,
  CardSummary,
  ItemsCreated,
  Label,
  MoveResult,
  Mutated,
} from '@/api/types';
import { itemCounts } from '@/lib/badges';
import {
  applyArchive,
  applyCardPatch,
  applyRemoveCard,
  applyUnarchive,
  byPosition,
  nextTempId,
  selectCard,
  setBoardVersion,
  type BadgeCounts,
  type BoardState,
  type CardRow,
  type Id,
  type LabelRow,
} from '@/lib/boardState';
import { invalidateArchived } from './useArchived';
import { activityKey } from './useBoardActivity';
import { boardKey, invalidateBoard, mergeCardRow } from './useBoardData';
import { cardKey } from './useCard';
import { errorMessage } from './mutationErrors';
import { useToast } from './useToast';

/**
 * The `position` an optimistic row carries until the response brings the real one. It sorts the
 * row last, which is where every append lands; it is a placeholder, never an ordering decision,
 * and no request ever carries it (CLAUDE.md section 3).
 */
const APPENDED = Number.MAX_SAFE_INTEGER;

function clamp(index: number, length: number): number {
  return Math.max(0, Math.min(index, length));
}

// ------------------------------------------------------------------ card detail reducers

/** Writes a new item array plus the two badge counts that follow from it. */
function withItems(detail: CardDetail, items: readonly CardItem[]): CardDetail {
  return {
    ...detail,
    items: [...items],
    badges: { ...detail.badges, ...itemCounts(items) },
  };
}

/** The same, re-sorted by `position`: how a server response is written back. */
function withSortedItems(detail: CardDetail, items: readonly CardItem[]): CardDetail {
  return withItems(detail, [...items].sort(byPosition));
}

/** Inserts or replaces one item, in `position` order. */
function putItem(detail: CardDetail, item: CardItem): CardDetail {
  const rest = detail.items.filter((row) => row.id !== item.id);
  return withSortedItems(detail, [...rest, item]);
}

/** The optimistic insert of the "Add an item" composer: a splice at `index`, or an append. */
function insertItem(detail: CardDetail, item: CardItem, index: number | undefined): CardDetail {
  const items = [...detail.items];
  items.splice(index === undefined ? items.length : clamp(index, items.length), 0, item);
  return withItems(detail, items);
}

function dropItem(detail: CardDetail, itemId: Id): CardDetail {
  return withItems(
    detail,
    detail.items.filter((row) => row.id !== itemId),
  );
}

function patchItem(detail: CardDetail, itemId: Id, patch: Partial<CardItem>): CardDetail {
  return withItems(
    detail,
    detail.items.map((row) => (row.id === itemId ? { ...row, ...patch, id: row.id } : row)),
  );
}

/** The `ITEM` drag: one splice in the card's item order, no position computed. */
function spliceItem(detail: CardDetail, itemId: Id, index: number): CardDetail {
  const moving = detail.items.find((row) => row.id === itemId);
  if (moving === undefined) return detail;
  const rest = detail.items.filter((row) => row.id !== itemId);
  rest.splice(clamp(index, rest.length), 0, moving);
  return withItems(detail, rest);
}

/** A `MoveResult`'s `positions` map over the card's items (Section 4.9); unknown ids ignored. */
function applyItemPositions(
  detail: CardDetail,
  positions: Readonly<Record<string, number>>,
): CardDetail {
  return withSortedItems(
    detail,
    detail.items.map((item) => {
      const position = positions[String(item.id)];
      return position === undefined ? item : { ...item, position };
    }),
  );
}

/** Merges a `CardSummary` response into the detail, keeping the fields only the detail carries. */
function mergeSummaryIntoDetail(detail: CardDetail, summary: CardSummary): CardDetail {
  return { ...detail, ...summary };
}

// ------------------------------------------------------------------ board cache reducers

/** The badge patch that lights a tile up without refetching the board (Section 5.4.3). */
function patchCardBadges(state: BoardState, cardId: Id, patch: Partial<BadgeCounts>): BoardState {
  const card = selectCard(state, cardId);
  if (card === undefined) return state;
  return applyCardPatch(state, cardId, { badges: { ...card.badges, ...patch } });
}

/** The tile's item list, and the two counts that follow from it (Section 2.5.1). */
function putCardItems(state: BoardState, cardId: Id, items: readonly CardItem[]): BoardState {
  const card = selectCard(state, cardId);
  if (card === undefined) return state;
  return applyCardPatch(state, cardId, {
    items: [...items],
    badges: { ...card.badges, ...itemCounts(items) },
  });
}

function putLabel(state: BoardState, label: LabelRow): BoardState {
  return { ...state, labels: { ...state.labels, [label.id]: label } };
}

/** `DELETE /api/labels/{label_id}` cascades `card_labels`, so every chip of it goes too. */
function dropLabel(state: BoardState, labelId: Id): BoardState {
  const labels = { ...state.labels };
  delete labels[labelId];
  const cards: Record<Id, CardRow> = {};
  for (const card of Object.values(state.cards)) {
    cards[card.id] = card.label_ids.includes(labelId)
      ? { ...card, label_ids: card.label_ids.filter((id) => id !== labelId) }
      : card;
  }
  return { ...state, labels, cards };
}

/** Toggles one label id, keeping the array in the palette order the chips row renders. */
function toggleLabelIds(
  ids: readonly Id[],
  labelId: Id,
  attached: boolean,
  labels: Readonly<Record<Id, LabelRow>>,
): Id[] {
  if (!attached) return ids.filter((id) => id !== labelId);
  if (ids.includes(labelId)) return [...ids];
  const next = [...ids, labelId];
  return next.sort((left, right) => {
    const a = labels[left];
    const b = labels[right];
    return a === undefined || b === undefined ? 0 : byPosition(a, b);
  });
}

// --------------------------------------------------------------------------- the recipe

interface CardSnapshot {
  detail: CardDetail | undefined;
  board: BoardState | undefined;
}

interface CardMutationConfig<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  /** The toast shown when the request fails and the snapshots go back in. */
  message: string;
  /** The optimistic change to `['card', cardId]`; it also sees the board for label order. */
  detail?: (detail: CardDetail, variables: TVariables, board: BoardState | undefined) => CardDetail;
  /** The optimistic change to `['board', boardId]`; it sees the already-patched detail. */
  board?: (state: BoardState, variables: TVariables, detail: CardDetail | undefined) => BoardState;
  mergeDetail?: (detail: CardDetail, data: TData, variables: TVariables) => CardDetail;
  mergeBoard?: (
    state: BoardState,
    data: TData,
    variables: TVariables,
    detail: CardDetail | undefined,
  ) => BoardState;
  /** A 204 answer carries no `board_version`, so the board refetches once it settles. */
  invalidateBoard?: boolean;
  /** True when the row crossed the archive line, so `['archived', boardId]` is stale. */
  touchesArchived?: boolean;
  /**
   * Whatever the response implies for a cache this recipe does not own — the `['card', id]`
   * entry of a deleted card. It runs after both merges, on success only.
   */
  onDone?: (data: TData, variables: TVariables, queryClient: QueryClient) => void;
}

/** The one recipe every mutation below follows. */
function useCardMutation<TData, TVariables>(
  boardId: number,
  cardId: number,
  config: CardMutationConfig<TData, TVariables>,
): UseMutationResult<TData, Error, TVariables, CardSnapshot> {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const detailKey = cardKey(cardId);
  const stateKey = boardKey(boardId);
  // The board's own key, which is the prefix of every card feed's, so one invalidation reaches
  // the drawer's feed and the open card's alike (`hooks/useBoardActivity.ts`).
  const activityFilter = { queryKey: activityKey(boardId) };

  return useMutation<TData, Error, TVariables, CardSnapshot>({
    mutationFn: config.mutationFn,
    onMutate: async (variables) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey }),
        queryClient.cancelQueries({ queryKey: stateKey }),
      ]);
      const snapshot: CardSnapshot = {
        detail: queryClient.getQueryData<CardDetail>(detailKey),
        board: queryClient.getQueryData<BoardState>(stateKey),
      };

      let detail = snapshot.detail;
      if (detail !== undefined && config.detail !== undefined) {
        detail = config.detail(detail, variables, snapshot.board);
        queryClient.setQueryData<CardDetail>(detailKey, detail);
      }
      if (snapshot.board !== undefined && config.board !== undefined) {
        queryClient.setQueryData<BoardState>(
          stateKey,
          config.board(snapshot.board, variables, detail),
        );
      }
      return snapshot;
    },
    onError: (error, _variables, snapshot) => {
      if (snapshot !== undefined) {
        if (snapshot.detail !== undefined) queryClient.setQueryData(detailKey, snapshot.detail);
        if (snapshot.board !== undefined) queryClient.setQueryData(stateKey, snapshot.board);
      }
      show(errorMessage(error, config.message), 'error');
    },
    onSuccess: (data, variables) => {
      const mergeDetail = config.mergeDetail;
      let detail = queryClient.getQueryData<CardDetail>(detailKey);
      if (detail !== undefined && mergeDetail !== undefined) {
        detail = mergeDetail(detail, data, variables);
        queryClient.setQueryData<CardDetail>(detailKey, detail);
      }
      const mergeBoard = config.mergeBoard;
      if (mergeBoard !== undefined) {
        queryClient.setQueryData<BoardState>(stateKey, (previous) =>
          previous === undefined ? undefined : mergeBoard(previous, data, variables, detail),
        );
      }
      config.onDone?.(data, variables, queryClient);
    },
    onSettled: () => {
      // Every write here records an activity row and no response carries feed entries, so the
      // feed is the one cache that is always refetched rather than patched (Section 5.4.3).
      void queryClient.invalidateQueries(activityFilter);
      if (config.invalidateBoard === true) invalidateBoard(queryClient, boardId);
      if (config.touchesArchived === true) invalidateArchived(queryClient, boardId);
    },
  });
}

/**
 * The board-side half of every item write: the tile lists the card's items and counts them in
 * its badge row (Sections 2.5.1 and 2.5.3). Both come from the detail the modal has just
 * patched, so one array is written and the list and the count cannot disagree.
 */
function syncItems(cardId: Id) {
  return (state: BoardState, _variables: unknown, detail: CardDetail | undefined): BoardState =>
    detail === undefined ? state : putCardItems(state, cardId, detail.items);
}

// -------------------------------------------------------------------------------- labels

export interface ToggleLabelVariables {
  labelId: Id;
  /** Whether the card should carry the label afterwards; the popover sends the new state. */
  attached: boolean;
}

/**
 * `PUT` / `DELETE /api/cards/{card_id}/labels/{label_id}` — the chip click of `LabelsPopover`
 * and the `1`-`9` shortcuts. Both verbs answer with the card's whole `label_ids` array, which is
 * written into the detail and into the tile's `CardRow` (Section 4.5).
 */
export function useToggleCardLabel(
  boardId: number,
  cardId: number,
): UseMutationResult<CardLabels, Error, ToggleLabelVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ labelId, attached }: ToggleLabelVariables) =>
      attached ? attachLabel(cardId, labelId) : detachLabel(cardId, labelId),
    message: "Couldn't update the labels. Try again.",
    detail: (detail, { labelId, attached }, board) => ({
      ...detail,
      label_ids: toggleLabelIds(detail.label_ids, labelId, attached, board?.labels ?? {}),
    }),
    board: (state, { labelId, attached }) => {
      const card = selectCard(state, cardId);
      return card === undefined
        ? state
        : applyCardPatch(state, cardId, {
            label_ids: toggleLabelIds(card.label_ids, labelId, attached, state.labels),
          });
    },
    mergeDetail: (detail, data) => ({ ...detail, label_ids: data.label_ids }),
    mergeBoard: (state, data) =>
      setBoardVersion(
        applyCardPatch(state, cardId, { label_ids: data.label_ids }),
        data.board_version,
      ),
  });
}

export type CreateLabelVariables = CreateLabelInput;

/**
 * `POST /api/boards/{board_id}/labels` — "Create a new label". The swatch appears in the palette
 * at once with a temporary id; the response swaps in the row and its real `position`.
 */
export function useCreateLabel(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<Label>, Error, CreateLabelVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: (input: CreateLabelVariables) => createLabel(boardId, input),
    message: "Couldn't create the label. Try again.",
    board: (state, input) =>
      putLabel(state, {
        id: nextTempId(),
        board_id: boardId,
        name: input.name ?? '',
        color: input.color,
        tone: input.tone ?? 'normal',
        position: APPENDED,
      }),
    mergeBoard: (state, { item, board_version }) => {
      const withoutDrafts = Object.values(state.labels)
        .filter((label) => label.position === APPENDED)
        .reduce((next, label) => dropLabel(next, label.id), state);
      return setBoardVersion(putLabel(withoutDrafts, item), board_version);
    },
  });
}

export interface UpdateLabelVariables extends UpdateLabelInput {
  labelId: Id;
}

/** `PATCH /api/labels/{label_id}` — the rename and recolour of the Edit label sub-view. */
export function useUpdateLabel(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<Label>, Error, UpdateLabelVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ labelId, ...input }: UpdateLabelVariables) => updateLabel(labelId, input),
    message: "Couldn't save the label. Try again.",
    board: (state, { labelId, ...patch }) => {
      const label = state.labels[labelId];
      return label === undefined ? state : putLabel(state, { ...label, ...patch, id: label.id });
    },
    mergeBoard: (state, { item, board_version }) =>
      setBoardVersion(putLabel(state, item), board_version),
  });
}

/**
 * `DELETE /api/labels/{label_id}` — it cascades `card_labels`, so the chip leaves every tile of
 * the board as well as this card. 204 carries no version, so the board is refetched once it
 * settles.
 */
export function useDeleteLabel(
  boardId: number,
  cardId: number,
): UseMutationResult<void, Error, Id, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: (labelId: Id) => deleteLabel(labelId),
    message: "Couldn't delete the label. Try again.",
    detail: (detail, labelId) => ({
      ...detail,
      label_ids: detail.label_ids.filter((id) => id !== labelId),
    }),
    board: (state, labelId) => dropLabel(state, labelId),
    invalidateBoard: true,
  });
}

// --------------------------------------------------------------------------------- items

export interface CreateItemVariables {
  name: string;
  index?: number;
}

/** `POST /api/cards/{card_id}/items` — one item from the "Add an item" composer. */
export function useCreateItem(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<CardItem>, Error, CreateItemVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ name, index }: CreateItemVariables) => createItem(cardId, { name, index }),
    message: "Couldn't add the item. Try again.",
    detail: (detail, { name, index }) =>
      insertItem(
        detail,
        {
          id: nextTempId(),
          card_id: cardId,
          name,
          position: APPENDED,
          is_checked: false,
          checked_at: null,
          due_at: null,
        },
        index,
      ),
    board: syncItems(cardId),
    mergeDetail: (detail, { item }) =>
      putItem(
        withItems(
          detail,
          detail.items.filter((row) => row.position !== APPENDED),
        ),
        item,
      ),
    mergeBoard: (state, { board_version }, _variables, detail) =>
      setBoardVersion(syncItems(cardId)(state, undefined, detail), board_version),
  });
}

/**
 * The same endpoint with `split_lines`: the "Add N items?" answer to a multi-line paste. The
 * server decides how many rows the paste becomes, so there is no optimistic insert.
 */
export function useCreateItems(
  boardId: number,
  cardId: number,
): UseMutationResult<ItemsCreated, Error, CreateItemVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ name, index }: CreateItemVariables) => createItems(cardId, { name, index }),
    message: "Couldn't add the items. Try again.",
    mergeDetail: (detail, data) => data.items.reduce((next, item) => putItem(next, item), detail),
    mergeBoard: (state, data, _variables, detail) =>
      setBoardVersion(syncItems(cardId)(state, undefined, detail), data.board_version),
  });
}

export interface UpdateItemVariables extends UpdateItemInput {
  itemId: Id;
}

/**
 * `PATCH /api/card-items/{item_id}` — the checkbox, the inline rename and `ItemDuePopover`.
 * The response carries the card's recomputed `badges`, so the tile's `done/total` comes from the
 * server rather than from a second count (Section 4.6).
 */
export function useUpdateItem(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<CardItemPatched>, Error, UpdateItemVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ itemId, ...input }: UpdateItemVariables) => updateItem(itemId, input),
    message: "Couldn't save the item. Try again.",
    detail: (detail, { itemId, ...patch }) => patchItem(detail, itemId, patch),
    board: syncItems(cardId),
    // The response is `CardItemOut & {badges}`; the badges belong to the card, not the row.
    mergeDetail: (detail, { item }) =>
      putItem(detail, {
        id: item.id,
        card_id: item.card_id,
        name: item.name,
        position: item.position,
        is_checked: item.is_checked,
        checked_at: item.checked_at,
        due_at: item.due_at,
      }),
    mergeBoard: (state, { item, board_version }, _variables, detail) =>
      setBoardVersion(
        patchCardBadges(syncItems(cardId)(state, undefined, detail), cardId, item.badges),
        board_version,
      ),
  });
}

/** `DELETE /api/card-items/{item_id}` — 204, so the board refetches once it settles. */
export function useDeleteItem(
  boardId: number,
  cardId: number,
): UseMutationResult<void, Error, Id, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: (itemId: Id) => deleteItem(itemId),
    message: "Couldn't delete the item. Try again.",
    detail: (detail, itemId) => dropItem(detail, itemId),
    board: syncItems(cardId),
    invalidateBoard: true,
  });
}

export interface MoveItemVariables {
  itemId: Id;
  index: number;
  prevId?: Id | null;
  nextId?: Id | null;
}

/** `POST /api/card-items/{item_id}/move` — a reorder inside this card (Section 2.6.3). */
export function useMoveItem(
  boardId: number,
  cardId: number,
): UseMutationResult<MoveResult<CardItem>, Error, MoveItemVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ itemId, index, prevId, nextId }: MoveItemVariables) =>
      moveItem(itemId, { index, prev_id: prevId, next_id: nextId }),
    message: "Couldn't move the item. Try again.",
    detail: (detail, { itemId, index }) => spliceItem(detail, itemId, index),
    board: syncItems(cardId),
    mergeDetail: (detail, data) => applyItemPositions(putItem(detail, data.item), data.positions),
    mergeBoard: (state, data, _variables, detail) =>
      setBoardVersion(syncItems(cardId)(state, undefined, detail), data.board_version),
  });
}

// -------------------------------------------------------------------------- card fields

export type UpdateCardFieldsVariables = UpdateCardInput;

/**
 * `PATCH /api/cards/{card_id}` — the modal's title textarea, `DescriptionEditor`,
 * `DatesPopover` (start, due, reminder and the Remove button's three nulls) and the
 * due-complete checkbox (Sections 2.6.2 to 2.6.4).
 *
 * `badges.description` is the one badge this response cannot be trusted for in the optimistic
 * pass: it follows from the text the editor just saved, so it is derived here and confirmed by
 * the `CardSummary` the server answers with.
 */
export function useUpdateCardFields(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<CardSummary>, Error, UpdateCardFieldsVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: (input: UpdateCardFieldsVariables) => updateCard(cardId, input),
    message: "Couldn't save the card. Try again.",
    detail: (detail, input) => {
      const next: CardDetail = { ...detail, ...input };
      return {
        ...next,
        badges: { ...next.badges, description: next.description !== '' },
      };
    },
    // `description` and `due_reminder_minutes` are detail-only fields, so the tile's row gets the
    // scalars it actually carries plus the one badge the description decides.
    board: (state, input) => {
      const card = selectCard(state, cardId);
      if (card === undefined) return state;
      return applyCardPatch(state, cardId, {
        title: input.title ?? card.title,
        start_at: input.start_at === undefined ? card.start_at : input.start_at,
        due_at: input.due_at === undefined ? card.due_at : input.due_at,
        due_complete: input.due_complete ?? card.due_complete,
        badges:
          input.description === undefined
            ? card.badges
            : { ...card.badges, description: input.description !== '' },
      });
    },
    mergeDetail: (detail, { item }) => mergeSummaryIntoDetail(detail, item),
    mergeBoard: (state, data) => mergeCardRow(state, data),
  });
}

// --------------------------------------------------------------- archive, restore and delete

/**
 * `POST /api/cards/{card_id}/archive` from the sidebar (2.6.4): the tile leaves the list and the
 * modal stays open, which is why this one patches `['card', id]` too — the archived banner of
 * 2.6.1 renders off `is_archived`. `useArchiveCard` in `hooks/useBoardMutations.ts` stays the
 * tile's and the quick editor's, where there is no detail in the cache to patch.
 */
export function useArchiveOpenCard(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<CardSummary>, Error, void, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: () => archiveCard(cardId),
    message: "Couldn't archive the card. Try again.",
    detail: (detail) => ({ ...detail, is_archived: true }),
    board: (state) => applyArchive(state, cardId),
    mergeDetail: (detail, { item }) => mergeSummaryIntoDetail(detail, item),
    mergeBoard: (state, data) => mergeCardRow(state, data),
    touchesArchived: true,
  });
}

/**
 * `POST /api/cards/{card_id}/unarchive` — "Send to board", and the row action of the archived
 * listing. The card returns to its own slot, because an archived row keeps its `position`; the
 * board with no active list left to receive it answers 409 `conflict` and `errorMessage` shows
 * the server's own sentence.
 */
export function useUnarchiveOpenCard(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<CardSummary>, Error, void, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: () => unarchiveCard(cardId),
    message: "Couldn't send the card back. Try again.",
    detail: (detail) => ({ ...detail, is_archived: false }),
    board: (state) => applyUnarchive(state, cardId),
    mergeDetail: (detail, { item }) => mergeSummaryIntoDetail(detail, item),
    mergeBoard: (state, data) => mergeCardRow(state, data),
    touchesArchived: true,
  });
}

/**
 * `DELETE /api/cards/{card_id}` — the `danger` Delete row of the sidebar (2.6.4), and the
 * archived listing's own. 204, and the card need not be archived first (Section 3.7). There is
 * no undo, which is why the row confirms first; the card's two cache entries are dropped
 * rather than refetched and the caller navigates back to the board.
 */
export function useDeleteCard(
  boardId: number,
  cardId: number,
): UseMutationResult<void, Error, void, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: () => deleteCard(cardId),
    message: "Couldn't delete the card. Try again.",
    board: (state) => applyRemoveCard(state, cardId),
    invalidateBoard: true,
    touchesArchived: true,
    onDone: (_data, _variables, queryClient) => {
      queryClient.removeQueries({ queryKey: cardKey(cardId) });
      queryClient.removeQueries({ queryKey: activityKey(boardId, cardId) });
    },
  });
}
