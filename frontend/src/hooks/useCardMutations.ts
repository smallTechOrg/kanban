/**
 * Every write the card detail modal makes: labels, members and watching, checklists, checklist
 * items, comments, attachments and covers, the card's own scalar fields, and the move, copy,
 * archive, restore and delete of Sections 2.6.4 and 4.5. All of them optimistic bar one — a file
 * upload has no row until its bytes have arrived, so `useUploadAttachments` renders a pending row
 * with the real progress fraction instead (Sections 5.8 and 6.9) — and all of them through one
 * recipe, the same one
 * `hooks/useBoardMutations.ts` uses for the board (Section 5.4.3) with one addition that
 * Section 5.4.3 states outright — "Card-modal mutations write to both `['card', id]` and the
 * matching `CardRow` in `['board', boardId]` so tile badges update instantly":
 *
 * - `onMutate` cancels the in-flight card, board and feed queries, snapshots all three and
 *   splices the change into each of them with a pure reducer.
 * - `onError` puts every snapshot back and shows a red toast.
 * - `onSuccess` writes the authoritative row, the `positions` map and the `board_version` the
 *   server returned.
 * - `onSettled` refetches the feed (every write here records an activity, and the response
 *   carries no feed rows) and, for the 204 deletes that carry no `board_version`, the board.
 *
 * The client never computes a `position`: a reducer only reorders rows, the move endpoints are
 * sent the `index` the drop produced, and the authoritative positions arrive with the response.
 *
 * The badge counts are not read back from the server either, except where the server volunteers
 * them: `PATCH /api/checklist-items/{item_id}` answers with the card's recomputed `badges`
 * (Section 4.6) and that object wins, while the optimistic pass derives `checklist_done` /
 * `checklist_total` from the detail's own checklists through `lib/badges.ts`.
 */
import { useCallback, useRef, useState } from 'react';
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  clearCover,
  createLinkAttachment,
  deleteAttachment,
  renameAttachment,
  setCover,
  uploadAttachment,
  type CoverInput,
  type LinkAttachmentInput,
} from '@/api/attachments';
import {
  archiveCard,
  copyCard,
  deleteCard,
  moveCard,
  unarchiveCard,
  updateCard,
  type CopyKeep,
  type UpdateCardInput,
} from '@/api/cards';
import {
  convertItem,
  createChecklist,
  createItem,
  createItems,
  deleteChecklist,
  deleteItem,
  moveChecklist,
  moveItem,
  renameChecklist,
  updateItem,
  type CreateChecklistInput,
  type UpdateItemInput,
} from '@/api/checklists';
import { createComment, deleteComment, updateComment } from '@/api/comments';
import {
  attachLabel,
  createLabel,
  deleteLabel,
  detachLabel,
  updateLabel,
  type CreateLabelInput,
  type UpdateLabelInput,
} from '@/api/labels';
import { assignMember, unassignMember, unwatchCard, watchCard } from '@/api/members';
import type {
  Attachment,
  CardCover,
  CardDetail,
  CardLabels,
  CardMembers,
  CardSummary,
  Checklist,
  ChecklistItem,
  ChecklistItemPatched,
  Comment,
  ItemsCreated,
  Label,
  MoveResult,
  Mutated,
  PublicUser,
  WatchState,
} from '@/api/types';
import { checklistCounts } from '@/lib/badges';
import {
  applyArchive,
  applyCardPatch,
  applyCardRow,
  applyMove,
  applyPositions,
  applyRemoveCard,
  applyUnarchive,
  byPosition,
  nextTempId,
  selectCard,
  setBoardVersion,
  type BadgeCounts,
  type BoardState,
  type CardRow,
  type CoverRow,
  type Id,
  type LabelRow,
} from '@/lib/boardState';
import { crossBoardTarget } from '@/lib/moveTargets';
import { invalidateArchived } from './useArchived';
import { useMe } from './useAuth';
import { boardKey, invalidateBoard, mergeCardRow } from './useBoardData';
import { boardChecklistsKey, cardKey, feedKey, type FeedPages } from './useCard';
import { useMeta } from './useMeta';
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

/** Writes a new checklist array plus the two badge counts that follow from it. */
function withChecklists(detail: CardDetail, checklists: readonly Checklist[]): CardDetail {
  return {
    ...detail,
    checklists: [...checklists],
    badges: { ...detail.badges, ...checklistCounts(checklists) },
  };
}

/** The same, re-sorted by `position`: how a server response is written back. */
function withSortedChecklists(detail: CardDetail, checklists: readonly Checklist[]): CardDetail {
  return withChecklists(detail, [...checklists].sort(byPosition));
}

function putChecklist(detail: CardDetail, checklist: Checklist): CardDetail {
  const rest = detail.checklists.filter((row) => row.id !== checklist.id);
  return withSortedChecklists(detail, [...rest, checklist]);
}

function dropChecklist(detail: CardDetail, checklistId: Id): CardDetail {
  return withChecklists(
    detail,
    detail.checklists.filter((row) => row.id !== checklistId),
  );
}

function patchChecklist(
  detail: CardDetail,
  checklistId: Id,
  patch: Partial<Checklist>,
): CardDetail {
  return withChecklists(
    detail,
    detail.checklists.map((row) =>
      row.id === checklistId ? { ...row, ...patch, id: row.id } : row,
    ),
  );
}

/** The `CHECKLIST` drag: one splice in the card's checklist order, no position computed. */
function spliceChecklist(detail: CardDetail, checklistId: Id, index: number): CardDetail {
  const moving = detail.checklists.find((row) => row.id === checklistId);
  if (moving === undefined) return detail;
  const rest = detail.checklists.filter((row) => row.id !== checklistId);
  rest.splice(clamp(index, rest.length), 0, moving);
  return withChecklists(detail, rest);
}

function findItem(detail: CardDetail, itemId: Id): ChecklistItem | undefined {
  for (const checklist of detail.checklists) {
    const item = checklist.items.find((row) => row.id === itemId);
    if (item !== undefined) return item;
  }
  return undefined;
}

/** Inserts or replaces one item inside the checklist it belongs to, in `position` order. */
function putItem(detail: CardDetail, item: ChecklistItem): CardDetail {
  return withChecklists(
    detail,
    detail.checklists.map((checklist) => {
      const without = checklist.items.filter((row) => row.id !== item.id);
      if (checklist.id !== item.checklist_id) {
        return without.length === checklist.items.length
          ? checklist
          : { ...checklist, items: without };
      }
      return { ...checklist, items: [...without, item].sort(byPosition) };
    }),
  );
}

/** The optimistic insert of the "Add an item" composer: a splice at `index`, or an append. */
function insertItem(
  detail: CardDetail,
  item: ChecklistItem,
  index: number | undefined,
): CardDetail {
  return withChecklists(
    detail,
    detail.checklists.map((checklist) => {
      if (checklist.id !== item.checklist_id) return checklist;
      const items = [...checklist.items];
      items.splice(index === undefined ? items.length : clamp(index, items.length), 0, item);
      return { ...checklist, items };
    }),
  );
}

function dropItem(detail: CardDetail, itemId: Id): CardDetail {
  return withChecklists(
    detail,
    detail.checklists.map((checklist) => {
      const items = checklist.items.filter((row) => row.id !== itemId);
      return items.length === checklist.items.length ? checklist : { ...checklist, items };
    }),
  );
}

function patchItem(detail: CardDetail, itemId: Id, patch: Partial<ChecklistItem>): CardDetail {
  const item = findItem(detail, itemId);
  if (item === undefined) return detail;
  return putItem(detail, { ...item, ...patch, id: item.id });
}

/** The `CHECKLIST_ITEM` drag: out of its checklist, into the destination at `index`. */
function spliceItem(detail: CardDetail, itemId: Id, toChecklistId: Id, index: number): CardDetail {
  const item = findItem(detail, itemId);
  if (item === undefined) return detail;
  const moved: ChecklistItem = { ...item, checklist_id: toChecklistId };
  return withChecklists(
    detail,
    detail.checklists.map((checklist) => {
      const without = checklist.items.filter((row) => row.id !== itemId);
      if (checklist.id !== toChecklistId) {
        return without.length === checklist.items.length
          ? checklist
          : { ...checklist, items: without };
      }
      const items = [...without];
      items.splice(clamp(index, items.length), 0, moved);
      return { ...checklist, items };
    }),
  );
}

/** A `MoveResult`'s `positions` map over checklists (Section 4.9); an unknown id is ignored. */
function applyChecklistPositions(
  detail: CardDetail,
  positions: Readonly<Record<string, number>>,
): CardDetail {
  return withSortedChecklists(
    detail,
    detail.checklists.map((checklist) => {
      const position = positions[String(checklist.id)];
      return position === undefined ? checklist : { ...checklist, position };
    }),
  );
}

/** The same map over checklist items, re-sorting every checklist it touched. */
function applyItemPositions(
  detail: CardDetail,
  positions: Readonly<Record<string, number>>,
): CardDetail {
  return withChecklists(
    detail,
    detail.checklists.map((checklist) => {
      let changed = false;
      const items = checklist.items.map((item) => {
        const position = positions[String(item.id)];
        if (position === undefined) return item;
        changed = true;
        return { ...item, position };
      });
      return changed ? { ...checklist, items: items.sort(byPosition) } : checklist;
    }),
  );
}

/** Merges a `CardSummary` response into the detail, keeping the fields only the detail carries. */
function mergeSummaryIntoDetail(detail: CardDetail, summary: CardSummary): CardDetail {
  return { ...detail, ...summary };
}

// ------------------------------------------------------------- attachment and cover reducers

/** Whether this cover is that attachment: `cover.value` is the id as text (Section 4.5). */
function isAttachmentCover(cover: CardCover | CoverRow | null, attachmentId: Id): boolean {
  return cover !== null && cover.kind === 'attachment' && Number(cover.value) === attachmentId;
}

/** `attachments[].is_cover` follows from the card's own cover, so it is derived, never stored. */
function withCoverFlags(detail: CardDetail): CardDetail {
  return {
    ...detail,
    attachments: detail.attachments.map((row) => {
      const isCover = isAttachmentCover(detail.cover, row.id);
      return row.is_cover === isCover ? row : { ...row, is_cover: isCover };
    }),
  };
}

/** Writes a new attachment array plus the badge count that follows from it (Section 2.5.3). */
function withAttachments(detail: CardDetail, attachments: readonly Attachment[]): CardDetail {
  return withCoverFlags({
    ...detail,
    attachments: [...attachments],
    badges: { ...detail.badges, attachments: attachments.length },
  });
}

/**
 * Inserts or replaces one row, keeping the order the server sent the rest in: an upload that
 * resolves out of turn must not reshuffle the section under the reader.
 */
function putAttachment(detail: CardDetail, attachment: Attachment): CardDetail {
  const known = detail.attachments.some((row) => row.id === attachment.id);
  return withAttachments(
    detail,
    known
      ? detail.attachments.map((row) => (row.id === attachment.id ? attachment : row))
      : [...detail.attachments, attachment],
  );
}

/** `DELETE /api/attachments/{id}` — and the cover goes with it when it was the cover (3.7). */
function dropAttachment(detail: CardDetail, attachmentId: Id): CardDetail {
  return withAttachments(
    { ...detail, cover: isAttachmentCover(detail.cover, attachmentId) ? null : detail.cover },
    detail.attachments.filter((row) => row.id !== attachmentId),
  );
}

/** The pending link row leaves when the server's row arrives, like every other draft here. */
function dropDraftAttachments(detail: CardDetail): CardDetail {
  return withAttachments(
    detail,
    detail.attachments.filter((row) => row.id > 0),
  );
}

/**
 * The cover the popover just asked for. An attachment cover borrows the thumbnail and dominant
 * colour off the row the card already holds, so the tile paints the image on the first frame
 * instead of waiting for the response (Sections 2.5.1 and 2.6.1).
 */
function draftCover(detail: CardDetail, input: CoverInput): CardCover {
  const size = input.size ?? 'normal';
  if (input.kind === 'color') return { kind: 'color', value: input.value, size };
  const attachment = detail.attachments.find((row) => row.id === Number(input.value));
  return {
    kind: 'attachment',
    value: input.value,
    size,
    ...(attachment?.thumb_url == null ? {} : { image_url: attachment.thumb_url }),
    ...(attachment?.dominant_color == null ? {} : { dominant_color: attachment.dominant_color }),
  };
}

// ------------------------------------------------------------------------- id-array reducers

/** Adds or removes one id, which is all a member toggle changes until the array comes back. */
function toggleId(ids: readonly Id[], id: Id, present: boolean): Id[] {
  if (!present) return ids.filter((candidate) => candidate !== id);
  return ids.includes(id) ? [...ids] : [...ids, id];
}

// ------------------------------------------------------------------ board cache reducers

/** The badge patch that lights a tile up without refetching the board (Section 5.4.3). */
function patchCardBadges(state: BoardState, cardId: Id, patch: Partial<BadgeCounts>): BoardState {
  const card = selectCard(state, cardId);
  if (card === undefined) return state;
  return applyCardPatch(state, cardId, { badges: { ...card.badges, ...patch } });
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

// ------------------------------------------------------------------------ feed reducers

/** The optimistic comment the `CommentBox` shows at the top of the newest page (2.6.3). */
function prependComment(pages: FeedPages, comment: Comment): FeedPages {
  const [newest, ...older] = pages.pages;
  if (newest === undefined) return pages;
  return {
    ...pages,
    pages: [{ ...newest, items: [{ kind: 'comment', comment }, ...newest.items] }, ...older],
  };
}

function patchFeedComment(pages: FeedPages, commentId: Id, patch: Partial<Comment>): FeedPages {
  return {
    ...pages,
    pages: pages.pages.map((page) => ({
      ...page,
      items: page.items.map((item) =>
        item.kind === 'comment' && item.comment.id === commentId
          ? { ...item, comment: { ...item.comment, ...patch, id: item.comment.id } }
          : item,
      ),
    })),
  };
}

function dropFeedComment(pages: FeedPages, commentId: Id): FeedPages {
  return {
    ...pages,
    pages: pages.pages.map((page) => ({
      ...page,
      items: page.items.filter(
        (item) => !(item.kind === 'comment' && item.comment.id === commentId),
      ),
    })),
  };
}

// --------------------------------------------------------------------------- the recipe

interface CardSnapshot {
  detail: CardDetail | undefined;
  board: BoardState | undefined;
  feeds: [QueryKey, FeedPages | undefined][];
}

interface CardMutationConfig<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  /** The toast shown when the request fails and the snapshots go back in. */
  message: string;
  /** The optimistic change to `['card', cardId]`; it also sees the board for label order. */
  detail?: (detail: CardDetail, variables: TVariables, board: BoardState | undefined) => CardDetail;
  /** The optimistic change to `['board', boardId]`; it sees the already-patched detail. */
  board?: (state: BoardState, variables: TVariables, detail: CardDetail | undefined) => BoardState;
  /** The optimistic change to every `['feed', cardId, details]` page set in the cache. */
  feed?: (pages: FeedPages, variables: TVariables) => FeedPages;
  mergeDetail?: (detail: CardDetail, data: TData, variables: TVariables) => CardDetail;
  mergeBoard?: (
    state: BoardState,
    data: TData,
    variables: TVariables,
    detail: CardDetail | undefined,
  ) => BoardState;
  /** A 204 answer carries no `board_version`, so the board refetches once it settles. */
  invalidateBoard?: boolean;
  /** False for the palette writes, whose activity row belongs to the board, not to this card. */
  touchesFeed?: boolean;
  /** True when the "Copy items from…" rows of `['checklists', boardId]` changed (Section 4.6). */
  touchesBoardChecklists?: boolean;
  /** True when the row crossed the archive line, so `['archived', boardId]` is stale. */
  touchesArchived?: boolean;
  /**
   * Whatever the response implies for a cache this recipe does not own: the *other* board of a
   * cross-board move, or the `['card', id]` entry of a deleted card. It runs after both merges,
   * on success only.
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
  const feedFilter = { queryKey: feedKey(cardId) };

  return useMutation<TData, Error, TVariables, CardSnapshot>({
    mutationFn: config.mutationFn,
    onMutate: async (variables) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey }),
        queryClient.cancelQueries({ queryKey: stateKey }),
        queryClient.cancelQueries(feedFilter),
      ]);
      const snapshot: CardSnapshot = {
        detail: queryClient.getQueryData<CardDetail>(detailKey),
        board: queryClient.getQueryData<BoardState>(stateKey),
        feeds: queryClient.getQueriesData<FeedPages>(feedFilter),
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
      const feed = config.feed;
      if (feed !== undefined) {
        queryClient.setQueriesData<FeedPages>(feedFilter, (pages) =>
          pages === undefined ? pages : feed(pages, variables),
        );
      }
      return snapshot;
    },
    onError: (error, _variables, snapshot) => {
      if (snapshot !== undefined) {
        if (snapshot.detail !== undefined) queryClient.setQueryData(detailKey, snapshot.detail);
        if (snapshot.board !== undefined) queryClient.setQueryData(stateKey, snapshot.board);
        for (const [key, pages] of snapshot.feeds) queryClient.setQueryData(key, pages);
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
      if (config.touchesFeed !== false) void queryClient.invalidateQueries(feedFilter);
      if (config.invalidateBoard === true) invalidateBoard(queryClient, boardId);
      if (config.touchesBoardChecklists === true) {
        void queryClient.invalidateQueries({ queryKey: boardChecklistsKey(boardId) });
      }
      if (config.touchesArchived === true) invalidateArchived(queryClient, boardId);
    },
  });
}

/** The board-side half of every checklist write: the tile's `done/total`, from the detail. */
function syncChecklistBadges(cardId: Id) {
  return (state: BoardState, _variables: unknown, detail: CardDetail | undefined): BoardState =>
    detail === undefined
      ? state
      : patchCardBadges(state, cardId, checklistCounts(detail.checklists));
}

/**
 * The board-side half of every attachment write: the paperclip count, and the cover when the
 * row that was the cover has just gone. Both come from the detail the reducer above produced,
 * which is the only place the card's attachment rows live (Section 4.5).
 */
function syncAttachmentBadge(cardId: Id) {
  return (state: BoardState, _variables: unknown, detail: CardDetail | undefined): BoardState => {
    if (detail === undefined) return state;
    const card = selectCard(state, cardId);
    if (card === undefined) return state;
    return applyCardPatch(state, cardId, {
      cover: detail.cover,
      badges: { ...card.badges, attachments: detail.attachments.length },
    });
  };
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
    touchesFeed: false,
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
    touchesFeed: false,
  });
}

/**
 * `DELETE /api/labels/{label_id}` — admin only, and it cascades `card_labels`, so the chip
 * leaves every tile of the board as well as this card. 204 carries no version, so the board is
 * refetched once it settles.
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
    touchesFeed: false,
  });
}

// ---------------------------------------------------------------------------- checklists

export type CreateChecklistVariables = CreateChecklistInput;

/**
 * `POST /api/cards/{card_id}/checklists` — `ChecklistPopover`'s "Add". The empty section appears
 * at once; when the popover selected a source, its copied items arrive with the response.
 */
export function useCreateChecklist(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<Checklist>, Error, CreateChecklistVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: (input: CreateChecklistVariables) => createChecklist(cardId, input),
    message: "Couldn't add the checklist. Try again.",
    detail: (detail, input) =>
      withChecklists(detail, [
        ...detail.checklists,
        {
          id: nextTempId(),
          card_id: cardId,
          name: input.name ?? 'Checklist',
          position: APPENDED,
          items: [],
        },
      ]),
    mergeDetail: (detail, { item }) =>
      putChecklist(
        withChecklists(
          detail,
          detail.checklists.filter((row) => row.position !== APPENDED),
        ),
        item,
      ),
    mergeBoard: (state, { board_version }, _variables, detail) =>
      setBoardVersion(syncChecklistBadges(cardId)(state, undefined, detail), board_version),
    touchesBoardChecklists: true,
  });
}

export interface RenameChecklistVariables {
  checklistId: Id;
  name: string;
}

/** `PATCH /api/checklists/{checklist_id}` — the inline rename on the section header. */
export function useRenameChecklist(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<Checklist>, Error, RenameChecklistVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ checklistId, name }: RenameChecklistVariables) =>
      renameChecklist(checklistId, name),
    message: "Couldn't rename the checklist. Try again.",
    detail: (detail, { checklistId, name }) => patchChecklist(detail, checklistId, { name }),
    mergeDetail: (detail, { item }) => putChecklist(detail, item),
    mergeBoard: (state, { board_version }) => setBoardVersion(state, board_version),
    touchesBoardChecklists: true,
  });
}

/** `DELETE /api/checklists/{checklist_id}` — 204; the items go with it and the badge drops. */
export function useDeleteChecklist(
  boardId: number,
  cardId: number,
): UseMutationResult<void, Error, Id, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: (checklistId: Id) => deleteChecklist(checklistId),
    message: "Couldn't delete the checklist. Try again.",
    detail: (detail, checklistId) => dropChecklist(detail, checklistId),
    board: syncChecklistBadges(cardId),
    invalidateBoard: true,
    touchesBoardChecklists: true,
  });
}

export interface MoveChecklistVariables {
  checklistId: Id;
  index: number;
  prevId?: Id | null;
  nextId?: Id | null;
}

/** `POST /api/checklists/{checklist_id}/move` — the `CHECKLIST` drag inside the modal (2.6.3). */
export function useMoveChecklist(
  boardId: number,
  cardId: number,
): UseMutationResult<MoveResult<Checklist>, Error, MoveChecklistVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ checklistId, index, prevId, nextId }: MoveChecklistVariables) =>
      moveChecklist(checklistId, { index, prev_id: prevId, next_id: nextId }),
    message: "Couldn't move the checklist. Try again.",
    detail: (detail, { checklistId, index }) => spliceChecklist(detail, checklistId, index),
    mergeDetail: (detail, data) =>
      applyChecklistPositions(putChecklist(detail, data.item), data.positions),
    mergeBoard: (state, data) => setBoardVersion(state, data.board_version),
  });
}

// ------------------------------------------------------------------------ checklist items

export interface CreateItemVariables {
  checklistId: Id;
  name: string;
  index?: number;
}

/** `POST /api/checklists/{checklist_id}/items` — one item from the "Add an item" composer. */
export function useCreateChecklistItem(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<ChecklistItem>, Error, CreateItemVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ checklistId, name, index }: CreateItemVariables) =>
      createItem(checklistId, { name, index }),
    message: "Couldn't add the item. Try again.",
    detail: (detail, { checklistId, name, index }) =>
      insertItem(
        detail,
        {
          id: nextTempId(),
          checklist_id: checklistId,
          name,
          position: APPENDED,
          is_checked: false,
          checked_at: null,
          due_at: null,
          assignee_id: null,
        },
        index,
      ),
    mergeDetail: (detail, { item }) =>
      putItem(
        withChecklists(
          detail,
          detail.checklists.map((checklist) => ({
            ...checklist,
            items: checklist.items.filter((row) => row.position !== APPENDED),
          })),
        ),
        item,
      ),
    mergeBoard: (state, { board_version }, _variables, detail) =>
      setBoardVersion(syncChecklistBadges(cardId)(state, undefined, detail), board_version),
  });
}

/**
 * The same endpoint with `split_lines`: the "Add N items?" answer to a multi-line paste. The
 * server decides how many rows the paste becomes, so there is no optimistic insert.
 */
export function useCreateChecklistItems(
  boardId: number,
  cardId: number,
): UseMutationResult<ItemsCreated, Error, CreateItemVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ checklistId, name, index }: CreateItemVariables) =>
      createItems(checklistId, { name, index }),
    message: "Couldn't add the items. Try again.",
    mergeDetail: (detail, data) => data.items.reduce((next, item) => putItem(next, item), detail),
    mergeBoard: (state, data, _variables, detail) =>
      setBoardVersion(syncChecklistBadges(cardId)(state, undefined, detail), data.board_version),
  });
}

export interface UpdateItemVariables extends UpdateItemInput {
  itemId: Id;
}

/**
 * `PATCH /api/checklist-items/{item_id}` — the checkbox, the inline rename, `ItemDuePopover` and
 * `ItemAssignPopover`. The response carries the card's recomputed `badges`, so the tile's
 * `done/total` comes from the server rather than from a second count (Section 4.6).
 */
export function useUpdateChecklistItem(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<ChecklistItemPatched>, Error, UpdateItemVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ itemId, ...input }: UpdateItemVariables) => updateItem(itemId, input),
    message: "Couldn't save the item. Try again.",
    detail: (detail, { itemId, ...patch }) => patchItem(detail, itemId, patch),
    board: syncChecklistBadges(cardId),
    // The response is `ChecklistItemOut & {badges}`; the badges belong to the card, not the row.
    mergeDetail: (detail, { item }) =>
      putItem(detail, {
        id: item.id,
        checklist_id: item.checklist_id,
        name: item.name,
        position: item.position,
        is_checked: item.is_checked,
        checked_at: item.checked_at,
        due_at: item.due_at,
        assignee_id: item.assignee_id,
      }),
    mergeBoard: (state, { item, board_version }) =>
      setBoardVersion(patchCardBadges(state, cardId, item.badges), board_version),
  });
}

/** `DELETE /api/checklist-items/{item_id}` — 204, so the board refetches once it settles. */
export function useDeleteChecklistItem(
  boardId: number,
  cardId: number,
): UseMutationResult<void, Error, Id, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: (itemId: Id) => deleteItem(itemId),
    message: "Couldn't delete the item. Try again.",
    detail: (detail, itemId) => dropItem(detail, itemId),
    board: syncChecklistBadges(cardId),
    invalidateBoard: true,
  });
}

export interface MoveItemVariables {
  itemId: Id;
  toChecklistId: Id;
  index: number;
  prevId?: Id | null;
  nextId?: Id | null;
}

/** `POST /api/checklist-items/{item_id}/move` — within or across this card's checklists. */
export function useMoveChecklistItem(
  boardId: number,
  cardId: number,
): UseMutationResult<MoveResult<ChecklistItem>, Error, MoveItemVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ itemId, toChecklistId, index, prevId, nextId }: MoveItemVariables) =>
      moveItem(itemId, {
        to_checklist_id: toChecklistId,
        index,
        prev_id: prevId,
        next_id: nextId,
      }),
    message: "Couldn't move the item. Try again.",
    detail: (detail, { itemId, toChecklistId, index }) =>
      spliceItem(detail, itemId, toChecklistId, index),
    mergeDetail: (detail, data) => applyItemPositions(putItem(detail, data.item), data.positions),
    mergeBoard: (state, data) => setBoardVersion(state, data.board_version),
  });
}

export interface ConvertItemVariables {
  itemId: Id;
  index?: number | 'bottom';
}

/**
 * `POST /api/checklist-items/{item_id}/convert` — "Convert to card": the item leaves the
 * checklist and a new card with its text appears in the same list.
 */
export function useConvertChecklistItem(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<CardSummary>, Error, ConvertItemVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ itemId, index }: ConvertItemVariables) => convertItem(itemId, { index }),
    message: "Couldn't convert the item. Try again.",
    detail: (detail, { itemId }) => dropItem(detail, itemId),
    board: syncChecklistBadges(cardId),
    mergeBoard: (state, data, _variables, detail) =>
      mergeCardRow(syncChecklistBadges(cardId)(state, undefined, detail), data),
  });
}

// ------------------------------------------------------------------------------ comments

export interface CreateCommentVariables {
  body: string;
}

/**
 * `POST /api/cards/{card_id}/comments` — the `CommentBox`. The row appears at the top of the
 * newest feed page with a temporary id (`isTempId`, so the component hides Edit and Delete until
 * it resolves) and the tile's comment count goes up at once.
 */
export function useCreateComment(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<Comment>, Error, CreateCommentVariables, CardSnapshot> {
  const me = useMe().data;
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ body }: CreateCommentVariables) => createComment(cardId, body),
    message: "Couldn't post the comment. Try again.",
    feed: (pages, { body }) => {
      if (me === undefined) return pages;
      const author: PublicUser = {
        id: me.id,
        username: me.username,
        full_name: me.full_name,
        initials: me.initials,
        avatar_color: me.avatar_color,
      };
      return prependComment(pages, {
        id: nextTempId(),
        card_id: cardId,
        user: author,
        body,
        created_at: new Date().toISOString(),
        edited_at: null,
      });
    },
    detail: (detail) => ({
      ...detail,
      badges: { ...detail.badges, comments: detail.badges.comments + 1 },
    }),
    board: (state) => {
      const card = selectCard(state, cardId);
      return card === undefined
        ? state
        : patchCardBadges(state, cardId, { comments: card.badges.comments + 1 });
    },
    mergeBoard: (state, { board_version }) => setBoardVersion(state, board_version),
  });
}

export interface UpdateCommentVariables {
  commentId: Id;
  body: string;
}

/** `PATCH /api/comments/{comment_id}` — the author's own edit; the feed adds "(edited)". */
export function useUpdateComment(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<Comment>, Error, UpdateCommentVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ commentId, body }: UpdateCommentVariables) => updateComment(commentId, body),
    message: "Couldn't save the comment. Try again.",
    feed: (pages, { commentId, body }) =>
      patchFeedComment(pages, commentId, { body, edited_at: new Date().toISOString() }),
    mergeBoard: (state, { board_version }) => setBoardVersion(state, board_version),
  });
}

/** `DELETE /api/comments/{comment_id}` — 204; the author, or any board admin (Section 4.6). */
export function useDeleteComment(
  boardId: number,
  cardId: number,
): UseMutationResult<void, Error, Id, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: (commentId: Id) => deleteComment(commentId),
    message: "Couldn't delete the comment. Try again.",
    feed: (pages, commentId) => dropFeedComment(pages, commentId),
    detail: (detail) => ({
      ...detail,
      badges: { ...detail.badges, comments: Math.max(0, detail.badges.comments - 1) },
    }),
    board: (state) => {
      const card = selectCard(state, cardId);
      return card === undefined
        ? state
        : patchCardBadges(state, cardId, { comments: Math.max(0, card.badges.comments - 1) });
    },
    invalidateBoard: true,
  });
}

// -------------------------------------------------------------------------- card fields

export type UpdateCardFieldsVariables = UpdateCardInput;

/**
 * `PATCH /api/cards/{card_id}` — the modal's title textarea, `DescriptionEditor`,
 * `DatesPopover` (start, due, reminder and the Remove button's three nulls), the due-complete
 * checkbox and "Make template" (Sections 2.6.2 to 2.6.4).
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
        is_template: input.is_template ?? card.is_template,
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

// ------------------------------------------------------------------- members and watching

export interface ToggleMemberVariables {
  userId: Id;
  /** Whether the card should carry the member afterwards; the popover sends the new state. */
  assigned: boolean;
}

/**
 * `PUT` / `DELETE /api/cards/{card_id}/members/{user_id}` — `MembersPopover`'s rows, the
 * sidebar's "Join" and the `Space` shortcut. Like the label toggle both verbs answer with the
 * card's whole `member_ids` array, which is written into the detail and into the tile's row, so
 * the avatars move on the first frame and the authoritative order arrives with the response
 * (Section 4.5).
 */
export function useToggleCardMember(
  boardId: number,
  cardId: number,
): UseMutationResult<CardMembers, Error, ToggleMemberVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ userId, assigned }: ToggleMemberVariables) =>
      assigned ? assignMember(cardId, userId) : unassignMember(cardId, userId),
    message: "Couldn't update the members. Try again.",
    detail: (detail, { userId, assigned }) => ({
      ...detail,
      member_ids: toggleId(detail.member_ids, userId, assigned),
    }),
    board: (state, { userId, assigned }) => {
      const card = selectCard(state, cardId);
      return card === undefined
        ? state
        : applyCardPatch(state, cardId, {
            member_ids: toggleId(card.member_ids, userId, assigned),
          });
    },
    mergeDetail: (detail, data) => ({ ...detail, member_ids: data.member_ids }),
    mergeBoard: (state, data) =>
      setBoardVersion(
        applyCardPatch(state, cardId, { member_ids: data.member_ids }),
        data.board_version,
      ),
  });
}

/**
 * `PUT` / `DELETE /api/cards/{card_id}/watch` — the two "Watch" tiles of Sections 2.6.3 and
 * 2.6.4 and the eye badge on the tile.
 *
 * This is the one mutation in this file that is not board state: it records no activity, bumps
 * no version and publishes no event (`user_write`, Section 4.1), so its response carries no
 * `board_version` to merge, the feed is not refetched, and the board cache is patched with the
 * flag the server answered with.
 */
export function useToggleWatch(
  boardId: number,
  cardId: number,
): UseMutationResult<WatchState, Error, boolean, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: (watching: boolean) => (watching ? watchCard(cardId) : unwatchCard(cardId)),
    message: "Couldn't change whether you watch this card. Try again.",
    detail: (detail, watching) => ({ ...detail, is_watching: watching }),
    board: (state, watching) => applyCardPatch(state, cardId, { is_watching: watching }),
    mergeDetail: (detail, data) => ({ ...detail, is_watching: data.is_watching }),
    mergeBoard: (state, data) => applyCardPatch(state, cardId, { is_watching: data.is_watching }),
    touchesFeed: false,
  });
}

// ---------------------------------------------------------------------------- attachments

/** One megabyte, for the size guard `meta.max_upload_mb` states in megabytes (Section 5.8). */
const BYTES_PER_MB = 1024 * 1024;

/**
 * A file on the wire. It has no id yet — the row is inserted by the server after the bytes have
 * arrived, because the id names the directory they are stored in (Section 6.9) — so the section
 * renders these beside the stored rows, keyed on `key`, with the 4px progress bar of 2.6.3.
 */
export interface PendingUpload {
  key: string;
  name: string;
  size_bytes: number;
  /** `0..1` of the bytes sent, or `null` until the browser reports a total. */
  progress: number | null;
}

export interface UploadAttachmentsResult {
  /**
   * Uploads the files one after another (Section 5.8). `onUploaded` is how "Upload a cover
   * image" (2.6.5) and the comment box's paste chain their own step onto the stored row.
   */
  upload: (files: readonly File[], onUploaded?: (attachment: Attachment) => void) => void;
  pending: PendingUpload[];
  isUploading: boolean;
  /** `meta.max_upload_mb`, or `null` while `['meta']` is still loading (never a second copy). */
  maxUploadMb: number | null;
}

/** Writes one stored attachment into both caches; an upload has no optimistic row to swap. */
function writeUploadedAttachment(
  queryClient: QueryClient,
  boardId: number,
  cardId: number,
  { item, board_version }: Mutated<Attachment>,
): void {
  const detailKey = cardKey(cardId);
  const detail = queryClient.getQueryData<CardDetail>(detailKey);
  const next = detail === undefined ? undefined : putAttachment(detail, item);
  if (next !== undefined) queryClient.setQueryData<CardDetail>(detailKey, next);
  queryClient.setQueryData<BoardState>(boardKey(boardId), (previous) => {
    if (previous === undefined) return undefined;
    const card = selectCard(previous, cardId);
    if (card === undefined) return setBoardVersion(previous, board_version);
    const attachments = next === undefined ? card.badges.attachments + 1 : next.attachments.length;
    return setBoardVersion(patchCardBadges(previous, cardId, { attachments }), board_version);
  });
  // `attachment.added` is an activity row like every other write's (Section 3.8).
  void queryClient.invalidateQueries({ queryKey: feedKey(cardId) });
}

/**
 * `POST /api/cards/{card_id}/attachments`, multipart — the file input, the drop zone and the
 * comment box's paste (Section 5.8).
 *
 * This is the one write in the card modal that cannot be optimistic: the row exists only once
 * the bytes have arrived, and the name, size, thumbnail and dominant colour are all decided
 * server-side (Section 6.9). Instead of a fake row the hook publishes one `PendingUpload` per
 * file carrying the real `upload.onprogress` fraction, and replaces it with the stored row when
 * the response lands.
 *
 * The size guard of Section 5.8 lives here rather than in the popover because `max_upload_mb` is
 * server state read through `['meta']`, and the rule is one toast, not one per caller.
 */
export function useUploadAttachments(boardId: number, cardId: number): UploadAttachmentsResult {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const maxUploadMb = useMeta().data?.max_upload_mb ?? null;
  const [pending, setPending] = useState<PendingUpload[]>([]);
  // One chain, so files queue behind whatever is already on the wire instead of racing it.
  const queue = useRef<Promise<void>>(Promise.resolve());

  const upload = useCallback(
    (files: readonly File[], onUploaded?: (attachment: Attachment) => void) => {
      const accepted = files.filter((file) => {
        if (maxUploadMb !== null && file.size > maxUploadMb * BYTES_PER_MB) {
          show(`Files must be under ${maxUploadMb} MB`, 'error');
          return false;
        }
        return true;
      });
      if (accepted.length === 0) return;

      const rows: PendingUpload[] = accepted.map((file) => ({
        key: crypto.randomUUID(),
        name: file.name,
        size_bytes: file.size,
        progress: null,
      }));
      setPending((current) => [...current, ...rows]);

      queue.current = queue.current.then(async () => {
        for (const [at, file] of accepted.entries()) {
          const row = rows[at];
          if (row === undefined) continue;
          try {
            const data = await uploadAttachment(cardId, file, {
              onProgress: ({ fraction }) => {
                setPending((current) =>
                  current.map((candidate) =>
                    candidate.key === row.key ? { ...candidate, progress: fraction } : candidate,
                  ),
                );
              },
            });
            writeUploadedAttachment(queryClient, boardId, cardId, data);
            onUploaded?.(data.item);
          } catch (error) {
            show(errorMessage(error, `Couldn't upload ${file.name}. Try again.`), 'error');
          } finally {
            setPending((current) => current.filter((candidate) => candidate.key !== row.key));
          }
        }
      });
    },
    [boardId, cardId, maxUploadMb, queryClient, show],
  );

  return { upload, pending, isUploading: pending.length > 0, maxUploadMb };
}

export type CreateLinkAttachmentVariables = LinkAttachmentInput;

/**
 * The same endpoint as JSON: "Search or paste a link" (2.6.5). This half *can* be optimistic —
 * there are no bytes and nothing to sniff — so the row appears at once with a temporary id under
 * the typed display text, or under the URL itself until the server answers with the host it
 * defaults the name to.
 */
export function useCreateLinkAttachment(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<Attachment>, Error, CreateLinkAttachmentVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: (input: CreateLinkAttachmentVariables) => createLinkAttachment(cardId, input),
    message: "Couldn't attach the link. Try again.",
    detail: (detail, input) =>
      withAttachments(detail, [
        ...detail.attachments,
        {
          id: nextTempId(),
          card_id: cardId,
          user_id: null,
          name: input.name === undefined || input.name === '' ? input.url : input.name,
          kind: 'link',
          url: input.url,
          mime_type: null,
          size_bytes: null,
          is_image: false,
          thumb_url: null,
          dominant_color: null,
          is_cover: false,
          created_at: new Date().toISOString(),
        },
      ]),
    board: syncAttachmentBadge(cardId),
    mergeDetail: (detail, { item }) => putAttachment(dropDraftAttachments(detail), item),
    mergeBoard: (state, { board_version }, _variables, detail) =>
      setBoardVersion(syncAttachmentBadge(cardId)(state, undefined, detail), board_version),
  });
}

export interface RenameAttachmentVariables {
  attachmentId: Id;
  name: string;
}

/** `PATCH /api/attachments/{attachment_id}` — the display name; the file keeps its own (4.6). */
export function useRenameAttachment(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<Attachment>, Error, RenameAttachmentVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ attachmentId, name }: RenameAttachmentVariables) =>
      renameAttachment(attachmentId, name),
    message: "Couldn't rename the attachment. Try again.",
    detail: (detail, { attachmentId, name }) =>
      withAttachments(
        detail,
        detail.attachments.map((row) => (row.id === attachmentId ? { ...row, name } : row)),
      ),
    mergeDetail: (detail, { item }) => putAttachment(detail, item),
    mergeBoard: (state, { board_version }) => setBoardVersion(state, board_version),
  });
}

/**
 * `DELETE /api/attachments/{attachment_id}` — 204, no undo. When the row was the card's cover the
 * server clears the cover in the same transaction (Section 3.7), so the reducer clears it here
 * too and the tile loses its band at the moment the section loses its row.
 */
export function useDeleteAttachment(
  boardId: number,
  cardId: number,
): UseMutationResult<void, Error, Id, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: (attachmentId: Id) => deleteAttachment(attachmentId),
    message: "Couldn't delete the attachment. Try again.",
    detail: (detail, attachmentId) => dropAttachment(detail, attachmentId),
    board: syncAttachmentBadge(cardId),
    invalidateBoard: true,
  });
}

// --------------------------------------------------------------------------------- covers

export type SetCoverVariables = CoverInput;

/**
 * `PUT /api/cards/{card_id}/cover` — the colour swatches, the attachment thumbnails and the two
 * size tiles of `CoverPopover` (2.6.5). The response is the whole card, so the tile's band and
 * the modal's 160px strip both follow from one round trip.
 */
export function useSetCover(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<CardSummary>, Error, SetCoverVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: (input: SetCoverVariables) => setCover(cardId, input),
    message: "Couldn't set the cover. Try again.",
    detail: (detail, input) => withCoverFlags({ ...detail, cover: draftCover(detail, input) }),
    // The quick editor (2.5.4) opens this popover with no `['card', id]` entry loaded, so the
    // tile's band falls back to the colour or id the popover chose, without the thumbnail only
    // the detail's attachment rows can supply.
    board: (state, input, detail) =>
      applyCardPatch(state, cardId, {
        cover: detail?.cover ?? {
          kind: input.kind,
          value: input.value,
          size: input.size ?? 'normal',
        },
      }),
    mergeDetail: (detail, { item }) => withCoverFlags(mergeSummaryIntoDetail(detail, item)),
    mergeBoard: (state, data) => mergeCardRow(state, data),
  });
}

/** `DELETE /api/cards/{card_id}/cover` — "Remove cover"; 200 with the card, `cover: null`. */
export function useClearCover(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<CardSummary>, Error, void, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: () => clearCover(cardId),
    message: "Couldn't remove the cover. Try again.",
    detail: (detail) => withCoverFlags({ ...detail, cover: null }),
    board: (state) => applyCardPatch(state, cardId, { cover: null }),
    mergeDetail: (detail, { item }) => withCoverFlags(mergeSummaryIntoDetail(detail, item)),
    mergeBoard: (state, data) => mergeCardRow(state, data),
  });
}

// ------------------------------------------------------------------------- move and copy

export interface MoveCardToVariables {
  toListId: Id;
  /** 0-based over the destination's active cards: the Position select's value minus one. */
  index: number;
  /** The destination board; the popover may always send it, this one included. */
  toBoardId?: Id;
}

/**
 * `POST /api/cards/{card_id}/move` from `MoveCardPopover` and the header's list link (2.6.5).
 * The popover sends the `index` form only — never `prev_id` / `next_id`, which belong to
 * `onDragEnd` (Section 5.5) — so this hook and `useMoveCard` in `hooks/useBoardMutations.ts`
 * are the two callers Section 4.9 distinguishes, not two rules.
 *
 * A cross-board move is a different shape of write: the card gets a new `short_id`, loses its
 * labels and keeps only the members the target board knows, and the response's `board_version`
 * is the **target** board's (Section 4.5). Writing that number into this board's cache would
 * shut its version gate against every later event, so the card is spliced out of this board
 * instead and both boards are refetched. `['card', id]` is refetched as well, because it carries
 * the `board_name` and `list_name` that no move response returns.
 */
export function useMoveCardTo(
  boardId: number,
  cardId: number,
): UseMutationResult<MoveResult<CardSummary>, Error, MoveCardToVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ toListId, index, toBoardId }: MoveCardToVariables) =>
      moveCard(cardId, {
        to_list_id: toListId,
        index,
        to_board_id: crossBoardTarget(boardId, toBoardId),
      }),
    message: "Couldn't move card. Try again.",
    detail: (detail, { toListId, toBoardId }) => ({
      ...detail,
      list_id: toListId,
      board_id: toBoardId ?? detail.board_id,
    }),
    board: (state, { toListId, index, toBoardId }) =>
      crossBoardTarget(boardId, toBoardId) === undefined
        ? applyMove(state, { cardId, toListId, index })
        : applyRemoveCard(state, cardId),
    mergeDetail: (detail, { item }) => mergeSummaryIntoDetail(detail, item),
    mergeBoard: (state, data, { toBoardId }) =>
      crossBoardTarget(boardId, toBoardId) === undefined
        ? setBoardVersion(
            applyPositions(applyCardRow(state, data.item), data.positions),
            data.board_version,
          )
        : state,
    invalidateBoard: true,
    onDone: (_data, { toBoardId }, queryClient) => {
      void queryClient.invalidateQueries({ queryKey: cardKey(cardId) });
      const target = crossBoardTarget(boardId, toBoardId);
      if (target !== undefined) invalidateBoard(queryClient, target);
    },
  });
}

export interface CopyCardVariables {
  title: string;
  toListId: Id;
  index: number;
  /** Every flag explicitly, because the server defaults an absent one to `false` (2.6.5). */
  keep: CopyKeep;
  /** `false` is how "Create from template" turns a template card into an ordinary one (2.5.5). */
  isTemplate?: boolean;
}

/**
 * `POST /api/cards/{card_id}/copy` — `CopyCardPopover` and "Create from template" (2.5.5).
 *
 * Nothing is applied optimistically: the server decides what the copy contains, down to
 * duplicating the attachment files, so the new row arrives with the response and its children
 * with the refetch that follows. A copy that landed on another board writes nothing into this
 * one, for the same version-gate reason as the cross-board move above.
 */
export function useCopyCard(
  boardId: number,
  cardId: number,
): UseMutationResult<Mutated<CardSummary>, Error, CopyCardVariables, CardSnapshot> {
  return useCardMutation(boardId, cardId, {
    mutationFn: ({ title, toListId, index, keep, isTemplate }: CopyCardVariables) =>
      copyCard(cardId, { title, to_list_id: toListId, index, keep, is_template: isTemplate }),
    message: "Couldn't copy the card. Try again.",
    mergeBoard: (state, data) =>
      data.item.board_id === boardId ? mergeCardRow(state, data) : state,
    invalidateBoard: true,
    // `card.copied` is recorded on the new card, so it belongs to that card's feed, not this one.
    touchesFeed: false,
    onDone: ({ item }, _variables, queryClient) => {
      if (item.board_id !== boardId) invalidateBoard(queryClient, item.board_id);
    },
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
 * `DELETE /api/cards/{card_id}` — the `danger` row the archived sidebar offers (2.6.4). 204, and
 * 409 unless the card is archived (Section 3.7). There is no undo, so the card's own two cache
 * entries are dropped rather than refetched and the caller navigates back to the board.
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
    touchesFeed: false,
    onDone: (_data, _variables, queryClient) => {
      queryClient.removeQueries({ queryKey: cardKey(cardId) });
      queryClient.removeQueries({ queryKey: feedKey(cardId) });
    },
  });
}
