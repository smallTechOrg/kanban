/**
 * Every list and card mutation of M2, all of them optimistic, all through one recipe
 * (Section 5.4.3):
 *
 * - `onMutate` cancels the in-flight board query, snapshots `['board', boardId]` and splices
 *   the change into the cached `BoardState` with a pure reducer from `lib/boardState.ts`.
 * - `onError` restores the snapshot and shows a red toast.
 * - `onSuccess` writes the authoritative row, the `positions` map and `board_version` the
 *   server returned. A move never invalidates the board; only the bulk operations and the
 *   204 deletes (which carry no version) refetch on settle.
 *
 * The client never computes a `position`: a reducer only reorders ids, and `onDragEnd` sends
 * the `index` plus the neighbour ids read from the destination order with the dragged card
 * removed (Sections 4.9 and 5.5).
 *
 * Card creation mints `client_id = 'tmp_' + crypto.randomUUID().replace(/-/g, '')` and a
 * negative temporary id. A mutation issued against a card whose id is still temporary is
 * queued in `uiStore.pendingByClientId` and sent once the create response swaps the id in.
 */
import { useCallback } from 'react';
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  archiveCard,
  createCard,
  createCards,
  moveCard,
  unarchiveCard,
  updateCard,
} from '@/api/cards';
import {
  archiveAllCards,
  archiveList,
  copyList,
  createList,
  deleteList,
  moveAllCards,
  moveList,
  sortList,
  unarchiveCards,
  unarchiveList,
  updateList,
  type SortListBy,
  type UpdateListInput,
} from '@/api/lists';
import type {
  ArchiveAllCardsResult,
  CardSummary,
  CardsCreated,
  ListOut,
  MoveAllCardsResult,
  MoveResult,
  Mutated,
  PositionsResult,
  UnarchiveCardsResult,
} from '@/api/types';
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
  applyMove,
  applyPositions,
  applyRemoveList,
  applyUnarchive,
  applyUnarchiveList,
  clientIdFromUuid,
  draftCard,
  draftList,
  findCardByClientId,
  isTempId,
  nextTempId,
  selectCard,
  setBoardVersion,
  swapTempId,
  type BoardState,
  type Id,
  type SlotIndex,
} from '@/lib/boardState';
import { crossBoardTarget } from '@/lib/moveTargets';
import { useUiStore } from '@/store/uiStore';
import { invalidateArchived } from './useArchived';
import { boardKey, invalidateBoard, mergeCardRow } from './useBoardData';
import { errorMessage } from './mutationErrors';
import { useToast } from './useToast';

interface BoardSnapshot {
  state: BoardState | undefined;
}

interface BoardMutationConfig<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  /** The toast shown when the request fails and the snapshot goes back in. */
  message: string;
  optimistic?: (state: BoardState, variables: TVariables) => BoardState;
  merge?: (state: BoardState, data: TData, variables: TVariables) => BoardState;
  /** Bulk operations and the 204 deletes refetch once the dust settles (Section 5.4.3). */
  invalidate?: boolean;
  /**
   * The rows crossed the archive line, so both `['archived', boardId]` listings are stale: no
   * archive, restore or delete response carries the page the row belongs to, which is the rule
   * `hooks/useArchived.ts` owns for the whole app.
   */
  touchesArchived?: boolean;
  /**
   * True when the request was queued behind a card create, so the snapshot predates the id
   * swap: restoring it would put the temporary row back. Such a failure refetches instead.
   */
  deferred?: (variables: TVariables) => boolean;
  onDone?: (data: TData, variables: TVariables, queryClient: QueryClient) => void;
}

/** The one recipe every mutation below follows. */
function useBoardMutation<TData, TVariables>(
  boardId: number,
  config: BoardMutationConfig<TData, TVariables>,
): UseMutationResult<TData, Error, TVariables, BoardSnapshot> {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const key = boardKey(boardId);

  return useMutation<TData, Error, TVariables, BoardSnapshot>({
    mutationFn: config.mutationFn,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: key });
      const state = queryClient.getQueryData<BoardState>(key);
      const optimistic = config.optimistic;
      if (state !== undefined && optimistic !== undefined) {
        queryClient.setQueryData<BoardState>(key, optimistic(state, variables));
      }
      return { state };
    },
    onError: (error, variables, snapshot) => {
      const stale = config.deferred?.(variables) ?? false;
      if (stale) void queryClient.invalidateQueries({ queryKey: key });
      else if (snapshot?.state !== undefined) queryClient.setQueryData(key, snapshot.state);
      show(errorMessage(error, config.message), 'error');
    },
    onSuccess: (data, variables) => {
      const merge = config.merge;
      if (merge !== undefined) {
        queryClient.setQueryData<BoardState>(key, (previous) =>
          previous === undefined ? undefined : merge(previous, data, variables),
        );
      }
      if (config.touchesArchived === true) invalidateArchived(queryClient, boardId);
      config.onDone?.(data, variables, queryClient);
    },
    onSettled: config.invalidate === true ? () => invalidateBoard(queryClient, boardId) : undefined,
  });
}

/** Writes the row of a `Mutated<T>` response plus its `board_version`. */
function mergeList(state: BoardState, { item, board_version }: Mutated<ListOut>): BoardState {
  return setBoardVersion(applyListRow(state, item), board_version);
}

/** A move response: the row, then the rare `positions` map, then the version (Section 4.9). */
function mergeCardMove(state: BoardState, data: MoveResult<CardSummary>): BoardState {
  return setBoardVersion(
    applyPositions(applyCardRow(state, data.item), data.positions),
    data.board_version,
  );
}

function mergeListMove(state: BoardState, data: MoveResult<ListOut>): BoardState {
  return setBoardVersion(
    applyListPositions(applyListRow(state, data.item), data.positions),
    data.board_version,
  );
}

// ---------------------------------------------------------------------------- lists

export interface CreateListVariables {
  name: string;
  index?: number;
}

interface ListCreateContext extends BoardSnapshot {
  tempId: Id;
}

/**
 * `POST /api/boards/{board_id}/lists`. The column appears at once with a temporary id; the
 * response swaps in the real row, whose `position` decides where it finally sits.
 */
export function useCreateList(
  boardId: number,
): UseMutationResult<Mutated<ListOut>, Error, CreateListVariables, ListCreateContext> {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const key = boardKey(boardId);

  return useMutation<Mutated<ListOut>, Error, CreateListVariables, ListCreateContext>({
    mutationFn: (variables) => createList(boardId, variables),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: key });
      const state = queryClient.getQueryData<BoardState>(key);
      const tempId = nextTempId();
      if (state !== undefined) {
        const list = draftList({
          id: tempId,
          boardId,
          name: variables.name,
          now: new Date().toISOString(),
        });
        queryClient.setQueryData<BoardState>(
          key,
          applyCreateList(state, { list, index: variables.index }),
        );
      }
      return { state, tempId };
    },
    onError: (error, _variables, context) => {
      if (context?.state !== undefined) queryClient.setQueryData(key, context.state);
      show(errorMessage(error, "Couldn't add the list. Try again."), 'error');
    },
    onSuccess: ({ item, board_version }, _variables, context) => {
      const tempId = context.tempId;
      queryClient.setQueryData<BoardState>(key, (previous) =>
        previous === undefined
          ? undefined
          : setBoardVersion(applyListRow(applyRemoveList(previous, tempId), item), board_version),
      );
    },
  });
}

export interface UpdateListVariables extends UpdateListInput {
  listId: Id;
}

/** `PATCH /api/lists/{list_id}` — the inline rename and "Change list color". */
export function useUpdateList(
  boardId: number,
): UseMutationResult<Mutated<ListOut>, Error, UpdateListVariables, BoardSnapshot> {
  return useBoardMutation(boardId, {
    mutationFn: ({ listId, ...input }: UpdateListVariables) => updateList(listId, input),
    message: "Couldn't save the list. Try again.",
    optimistic: (state, { listId, ...patch }) => applyListPatch(state, listId, patch),
    merge: mergeList,
  });
}

export interface MoveListVariables {
  listId: Id;
  index: number;
  prevId?: Id | null;
  nextId?: Id | null;
  /** The destination board; the Move-list sub-view may always send it, this one included. */
  toBoardId?: Id;
}

/** `POST /api/lists/{list_id}/move` — the horizontal drag. Never invalidates the board. */
/**
 * `POST /api/lists/{list_id}/move` — the horizontal drag and the Move-list sub-view of Section
 * 2.4.3, which is the one caller that can name another board.
 *
 * A cross-board move is a different shape of write: the column and every card under it change
 * `board_id`, each card gets a fresh `short_id` and loses its labels (Section 3.6),
 * and the response's `board_version` is the **target** board's. Writing that number into this
 * board's cache would shut its version gate against every later event, so the column is spliced
 * out of this board instead and both boards are refetched — the same rule `useMoveCardTo`
 * follows for a card.
 */
export function useMoveList(
  boardId: number,
): UseMutationResult<MoveResult<ListOut>, Error, MoveListVariables, BoardSnapshot> {
  return useBoardMutation(boardId, {
    mutationFn: ({ listId, index, prevId, nextId, toBoardId }: MoveListVariables) =>
      moveList(listId, {
        index,
        prev_id: prevId,
        next_id: nextId,
        to_board_id: crossBoardTarget(boardId, toBoardId),
      }),
    message: "Couldn't move the list. Try again.",
    optimistic: (state, { listId, index, toBoardId }) =>
      crossBoardTarget(boardId, toBoardId) === undefined
        ? applyListMove(state, { listId, index })
        : applyRemoveList(state, listId),
    merge: (state, data, { toBoardId }) =>
      crossBoardTarget(boardId, toBoardId) === undefined ? mergeListMove(state, data) : state,
    onDone: (_data, { toBoardId }, queryClient) => {
      const target = crossBoardTarget(boardId, toBoardId);
      if (target !== undefined) {
        invalidateBoard(queryClient, boardId);
        invalidateBoard(queryClient, target);
      }
    },
  });
}

export interface CopyListVariables {
  listId: Id;
  name: string;
  index?: number;
}

/** `POST /api/lists/{list_id}/copy` — a deep copy, so the new cards arrive with the refetch. */
export function useCopyList(
  boardId: number,
): UseMutationResult<Mutated<ListOut>, Error, CopyListVariables, BoardSnapshot> {
  return useBoardMutation(boardId, {
    mutationFn: ({ listId, name, index }: CopyListVariables) => copyList(listId, { name, index }),
    message: "Couldn't copy the list. Try again.",
    merge: mergeList,
    invalidate: true,
  });
}

/** `POST /api/lists/{list_id}/archive` — the column leaves the canvas with its cards. */
export function useArchiveList(
  boardId: number,
): UseMutationResult<Mutated<ListOut>, Error, Id, BoardSnapshot> {
  return useBoardMutation(boardId, {
    mutationFn: (listId: Id) => archiveList(listId),
    message: "Couldn't archive the list. Try again.",
    optimistic: (state, listId) => applyArchiveList(state, listId),
    merge: mergeList,
    touchesArchived: true,
  });
}

/** `POST /api/lists/{list_id}/unarchive` — "Send to board", and the Undo of the toast above. */
export function useUnarchiveList(
  boardId: number,
): UseMutationResult<Mutated<ListOut>, Error, Id, BoardSnapshot> {
  return useBoardMutation(boardId, {
    mutationFn: (listId: Id) => unarchiveList(listId),
    message: "Couldn't send the list back. Try again.",
    optimistic: (state, listId) => applyUnarchiveList(state, listId),
    merge: mergeList,
    touchesArchived: true,
  });
}

/**
 * `DELETE /api/lists/{list_id}` — the "Delete" of the Archived items panel (Section 2.3.4). 204,
 * and 409 unless the list is archived, so the board cache only loses a row it no longer shows;
 * the 204 carries no `board_version`, which is why it settles with a refetch (Section 5.4.3).
 */
export function useDeleteList(boardId: number): UseMutationResult<void, Error, Id, BoardSnapshot> {
  return useBoardMutation(boardId, {
    mutationFn: (listId: Id) => deleteList(listId),
    message: "Couldn't delete the list. Try again.",
    optimistic: (state, listId) => applyRemoveList(state, listId),
    invalidate: true,
    touchesArchived: true,
  });
}

export interface MoveAllCardsVariables {
  listId: Id;
  toListId: Id;
}

/**
 * `POST /api/lists/{list_id}/move-all-cards`. Section 5.4.3 gives the four bulk operations a
 * spinner instead of an optimistic splice: the response's `positions` go in, then one refetch.
 */
export function useMoveAllCards(
  boardId: number,
): UseMutationResult<MoveAllCardsResult, Error, MoveAllCardsVariables, BoardSnapshot> {
  return useBoardMutation(boardId, {
    mutationFn: ({ listId, toListId }: MoveAllCardsVariables) => moveAllCards(listId, toListId),
    message: "Couldn't move the cards. Try again.",
    merge: (state, data) =>
      setBoardVersion(applyPositions(state, data.positions), data.board_version),
    invalidate: true,
  });
}

/** `POST /api/lists/{list_id}/archive-all-cards` — `archived_ids` feeds the Undo toast. */
export function useArchiveAllCards(
  boardId: number,
): UseMutationResult<ArchiveAllCardsResult, Error, Id, BoardSnapshot> {
  return useBoardMutation(boardId, {
    mutationFn: (listId: Id) => archiveAllCards(listId),
    message: "Couldn't archive the cards. Try again.",
    touchesArchived: true,
    merge: (state, data) =>
      setBoardVersion(
        data.archived_ids.reduce((next, cardId) => applyArchive(next, cardId), state),
        data.board_version,
      ),
    invalidate: true,
  });
}

export interface UnarchiveCardsVariables {
  listId: Id;
  cardIds: Id[];
}

/** `POST /api/lists/{list_id}/unarchive-cards` — the Undo of "Archive all cards". */
export function useUnarchiveCards(
  boardId: number,
): UseMutationResult<UnarchiveCardsResult, Error, UnarchiveCardsVariables, BoardSnapshot> {
  return useBoardMutation(boardId, {
    mutationFn: ({ listId, cardIds }: UnarchiveCardsVariables) => unarchiveCards(listId, cardIds),
    message: "Couldn't restore the cards. Try again.",
    touchesArchived: true,
    merge: (state, data, { cardIds }) =>
      setBoardVersion(
        cardIds.reduce((next, cardId) => applyUnarchive(next, cardId), state),
        data.board_version,
      ),
    invalidate: true,
  });
}

export interface SortListVariables {
  listId: Id;
  by: SortListBy;
}

/** `POST /api/lists/{list_id}/sort` — the server renumbers; the client writes `positions`. */
export function useSortList(
  boardId: number,
): UseMutationResult<PositionsResult, Error, SortListVariables, BoardSnapshot> {
  return useBoardMutation(boardId, {
    mutationFn: ({ listId, by }: SortListVariables) => sortList(listId, by),
    message: "Couldn't sort the list. Try again.",
    merge: (state, data) =>
      setBoardVersion(applyPositions(state, data.positions), data.board_version),
    invalidate: true,
  });
}

// ---------------------------------------------------------------------------- cards

export interface CreateCardVariables {
  listId: Id;
  title: string;
  index?: SlotIndex;
  label_ids?: Id[];
}

interface CardCreateContext extends BoardSnapshot {
  clientId: string;
  tempId: Id;
}

export interface CreateCardResult {
  /** Mints the ids, inserts the tile and posts the card. */
  addCard: (variables: CreateCardVariables) => void;
  isPending: boolean;
}

/**
 * `POST /api/lists/{list_id}/cards` (Section 2.4.4). The tile appears instantly with a
 * `client_id` the server stores and echoes, so `CardTile` — keyed on `client_id ?? id` — does
 * not remount when the real id arrives. Mutations queued behind this card replay on the swap.
 */
export function useCreateCard(boardId: number): CreateCardResult {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const takePending = useUiStore((state) => state.takePending);
  const key = boardKey(boardId);

  const mutation = useMutation<
    Mutated<CardSummary>,
    Error,
    CreateCardVariables & { clientId: string; tempId: Id },
    CardCreateContext
  >({
    mutationFn: ({ listId, title, index, label_ids, clientId }) =>
      createCard(listId, { title, index, client_id: clientId, label_ids }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: key });
      const state = queryClient.getQueryData<BoardState>(key);
      if (state !== undefined) {
        const card = draftCard({
          id: variables.tempId,
          clientId: variables.clientId,
          boardId,
          listId: variables.listId,
          title: variables.title,
          labelIds: variables.label_ids,
          now: new Date().toISOString(),
        });
        queryClient.setQueryData<BoardState>(
          key,
          applyCreate(state, { card, index: variables.index }),
        );
      }
      return { state, clientId: variables.clientId, tempId: variables.tempId };
    },
    onError: (error, _variables, context) => {
      if (context?.state !== undefined) queryClient.setQueryData(key, context.state);
      show(errorMessage(error, "Couldn't add the card. Try again."), 'error');
    },
    onSuccess: ({ item, board_version }, _variables, context) => {
      queryClient.setQueryData<BoardState>(key, (previous) =>
        previous === undefined
          ? undefined
          : setBoardVersion(swapTempId(previous, context.tempId, item), board_version),
      );
    },
    onSettled: (_data, _error, variables) => {
      // Whatever happened, the waiters must not hang: a replay re-reads the cache and either
      // finds the real id or fails loudly with its own toast.
      for (const replay of takePending(variables.clientId)) replay();
    },
  });

  const addCard = useCallback(
    (variables: CreateCardVariables) => {
      mutation.mutate({
        ...variables,
        clientId: clientIdFromUuid(crypto.randomUUID()),
        tempId: nextTempId(),
      });
    },
    [mutation],
  );

  return { addCard, isPending: mutation.isPending };
}

export interface CreateCardsVariables {
  listId: Id;
  /** The pasted block; the server makes one card per non-empty line, in order (Section 4.4). */
  title: string;
  index?: SlotIndex;
}

/**
 * The multi-line paste ("Create N cards?"). One request with `split_lines: true`, no optimistic
 * insert — the server decides how many cards the paste becomes — then one refetch.
 */
export function useCreateCards(
  boardId: number,
): UseMutationResult<CardsCreated, Error, CreateCardsVariables, BoardSnapshot> {
  return useBoardMutation(boardId, {
    mutationFn: ({ listId, title, index }: CreateCardsVariables) =>
      createCards(listId, { title, index }),
    message: "Couldn't add the cards. Try again.",
    merge: (state, data) =>
      setBoardVersion(
        data.items.reduce((next, card) => applyCardRow(next, card), state),
        data.board_version,
      ),
    invalidate: true,
  });
}

/**
 * Resolves a card id that may still be a temporary one: the mutation waits in
 * `uiStore.pendingByClientId` until the create response swaps the real id in (Section 5.4.3).
 */
function useCardIdResolver(boardId: number): (cardId: Id) => Promise<Id> {
  const queryClient = useQueryClient();
  const addPending = useUiStore((state) => state.addPending);

  return useCallback(
    async (cardId: Id): Promise<Id> => {
      if (!isTempId(cardId)) return cardId;
      const pendingState = queryClient.getQueryData<BoardState>(boardKey(boardId));
      const clientId =
        pendingState === undefined ? undefined : selectCard(pendingState, cardId)?.client_id;
      // No row behind the temporary id: its create already resolved or rolled back, and there
      // is nothing left to address. Failing here beats sending `/api/cards/-1`.
      if (clientId === undefined) throw new Error('That card is no longer on the board.');
      await new Promise<void>((resolve) => addPending(clientId, resolve));
      const settled = queryClient.getQueryData<BoardState>(boardKey(boardId));
      const created = settled === undefined ? undefined : findCardByClientId(settled, clientId);
      if (created === undefined || isTempId(created.id)) {
        throw new Error('The card has not been created yet.');
      }
      return created.id;
    },
    [addPending, boardId, queryClient],
  );
}

export interface UpdateCardVariables {
  cardId: Id;
  title: string;
}

/** `PATCH /api/cards/{card_id}` — the title edit of `QuickCardEditor` and `ListHeader`'s tiles. */
export function useUpdateCard(
  boardId: number,
): UseMutationResult<Mutated<CardSummary>, Error, UpdateCardVariables, BoardSnapshot> {
  const resolveCardId = useCardIdResolver(boardId);
  return useBoardMutation(boardId, {
    mutationFn: async ({ cardId, title }: UpdateCardVariables) =>
      updateCard(await resolveCardId(cardId), { title }),
    message: "Couldn't save the card. Try again.",
    optimistic: (state, { cardId, title }) => applyCardPatch(state, cardId, { title }),
    merge: mergeCardRow,
    deferred: ({ cardId }) => isTempId(cardId),
  });
}

export interface MoveCardVariables {
  cardId: Id;
  toListId: Id;
  index: number;
  prevId?: Id | null;
  nextId?: Id | null;
}

/**
 * `POST /api/cards/{card_id}/move` — the drag-and-drop endpoint. The optimistic change is the
 * index splice of Section 5.4.3, and the response's `position` / `positions` re-sort the
 * destination list. There is no invalidation: a refetch here would pull the tile out from
 * under the cursor.
 */
export function useMoveCard(
  boardId: number,
): UseMutationResult<MoveResult<CardSummary>, Error, MoveCardVariables, BoardSnapshot> {
  const resolveCardId = useCardIdResolver(boardId);
  return useBoardMutation(boardId, {
    mutationFn: async ({ cardId, toListId, index, prevId, nextId }: MoveCardVariables) =>
      moveCard(await resolveCardId(cardId), {
        to_list_id: toListId,
        index,
        prev_id: prevId,
        next_id: nextId,
      }),
    message: "Couldn't move card. Try again.",
    optimistic: (state, { cardId, toListId, index }) =>
      applyMove(state, { cardId, toListId, index }),
    merge: mergeCardMove,
    deferred: ({ cardId }) => isTempId(cardId),
  });
}

/** `POST /api/cards/{card_id}/archive` — the tile leaves the list; the row stays for Undo. */
export function useArchiveCard(
  boardId: number,
): UseMutationResult<Mutated<CardSummary>, Error, Id, BoardSnapshot> {
  const resolveCardId = useCardIdResolver(boardId);
  return useBoardMutation(boardId, {
    mutationFn: async (cardId: Id) => archiveCard(await resolveCardId(cardId)),
    message: "Couldn't archive the card. Try again.",
    optimistic: (state, cardId) => applyArchive(state, cardId),
    merge: mergeCardRow,
    deferred: (cardId) => isTempId(cardId),
    touchesArchived: true,
  });
}

/** `POST /api/cards/{card_id}/unarchive` — the Undo of the archive toast (Section 2.5.5). */
export function useUnarchiveCard(
  boardId: number,
): UseMutationResult<Mutated<CardSummary>, Error, Id, BoardSnapshot> {
  return useBoardMutation(boardId, {
    mutationFn: (cardId: Id) => unarchiveCard(cardId),
    message: "Couldn't send the card back. Try again.",
    optimistic: (state, cardId) => applyUnarchive(state, cardId),
    merge: mergeCardRow,
    touchesArchived: true,
  });
}
