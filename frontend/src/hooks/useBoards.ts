/**
 * The board queries and mutations of Section 4.3, keyed exactly as Section 5.4.1 defines:
 * `['boards']`, `['boards', 'closed']`, `['board', boardId]`. A board's members need no key
 * of their own: the board payload carries `members[]`, which `useMembers` reads.
 *
 * Starring is optimistic (CLAUDE.md section 5): snapshot, move the tile between groups,
 * roll back with a toast. The rest write the server's authoritative row into the cache and
 * invalidate the lists whose shape changed.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  closeBoard,
  createBoard,
  deleteBoard,
  listBoards,
  listClosedBoards,
  reopenBoard,
  starBoard,
  unstarBoard,
  updateBoard,
  type CreateBoardInput,
  type UpdateBoardInput,
} from '@/api/boards';
import type { BoardGroups, BoardSummary, ClosedBoards, Mutated } from '@/api/types';
import { setBoardStarred, sortBoardsByName } from '@/lib/boardGroups';
import type { BoardState } from '@/lib/boardState';
import { boardKey } from './useBoardData';
import { errorMessage } from './mutationErrors';
import { useToast } from './useToast';

/** The home groups. Exported because the background upload writes through it too (5.4.3). */
export const BOARDS_KEY = ['boards'] as const;
const CLOSED_BOARDS_KEY = ['boards', 'closed'] as const;

/** Section 4.3 defines no order for `closed`, so the modal lists those rows alphabetically. */
const selectClosedBoards = (data: ClosedBoards): BoardSummary[] => sortBoardsByName(data.closed);

/**
 * Writes a mutation's authoritative `BoardSummary` into the cached board document.
 *
 * `['board', boardId]` holds the normalised `BoardState` of Section 5.4.2 (`useBoardData`
 * fills it), whose `board` field is exactly the row these mutations return, so a rename, a
 * visibility change or a reopen is one field write and the lists, cards and members
 * around it are untouched.
 */
function mergeBoard(previous: BoardState | undefined, item: BoardSummary): BoardState | undefined {
  return previous === undefined ? undefined : { ...previous, board: item };
}

/**
 * `GET /api/boards` — the home page's three groups. Section 5.4.1 gives this key no
 * `staleTime`, so returning to the home page refetches and "Recently viewed" reflects the
 * board just opened; the window-focus refetch it asks for is the client default (`main.tsx`).
 */
export function useBoards(): UseQueryResult<BoardGroups, Error> {
  return useQuery({
    queryKey: BOARDS_KEY,
    queryFn: listBoards,
  });
}

/** `GET /api/boards?closed=1` — the rows of `ClosedBoardsModal`. */
export function useClosedBoards(): UseQueryResult<BoardSummary[], Error> {
  return useQuery({
    queryKey: CLOSED_BOARDS_KEY,
    queryFn: listClosedBoards,
    select: selectClosedBoards,
  });
}

/** `POST /api/boards`. The caller navigates to `/b/:boardId` with the returned tile. */
export function useCreateBoard(): UseMutationResult<BoardSummary, Error, CreateBoardInput> {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation({
    mutationFn: createBoard,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
    },
    onError: (error) => show(errorMessage(error, "Couldn't create the board."), 'error'),
  });
}

/** `PATCH /api/boards/{board_id}` — rename, description, visibility and background. */
export function useUpdateBoard(
  boardId: number,
): UseMutationResult<Mutated<BoardSummary>, Error, UpdateBoardInput> {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation({
    mutationFn: (input: UpdateBoardInput) => updateBoard(boardId, input),
    onSuccess: ({ item }) => {
      queryClient.setQueryData<BoardState>(boardKey(boardId), (previous) =>
        mergeBoard(previous, item),
      );
      void queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
    },
    onError: (error) => show(errorMessage(error, "Couldn't save changes."), 'error'),
  });
}

/**
 * Close and reopen share one recipe: the response is authoritative for the board document,
 * and both board lists change shape (the tile leaves one and joins the other).
 */
function useBoardStateChange(
  boardId: number,
  mutate: (id: number) => Promise<Mutated<BoardSummary>>,
  fallbackMessage: string,
): UseMutationResult<Mutated<BoardSummary>, Error, void> {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation({
    mutationFn: () => mutate(boardId),
    onSuccess: ({ item }) => {
      queryClient.setQueryData<BoardState>(boardKey(boardId), (previous) =>
        mergeBoard(previous, item),
      );
      void queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
      void queryClient.invalidateQueries({ queryKey: CLOSED_BOARDS_KEY });
    },
    onError: (error) => show(errorMessage(error, fallbackMessage), 'error'),
  });
}

/**
 * `POST /api/boards/{board_id}/close` — the "Close board…" confirm of the menu drawer (2.3.4),
 * admin only. The caller navigates to `/` once it resolves; a stale tab that stays open lands
 * on `ClosedBoardPage`, because the response is the authoritative board row.
 */
export function useCloseBoard(
  boardId: number,
): UseMutationResult<Mutated<BoardSummary>, Error, void> {
  return useBoardStateChange(boardId, closeBoard, "Couldn't close the board.");
}

/** `POST /api/boards/{board_id}/reopen` — admin only; allowed while the board is closed. */
export function useReopenBoard(
  boardId: number,
): UseMutationResult<Mutated<BoardSummary>, Error, void> {
  return useBoardStateChange(boardId, reopenBoard, "Couldn't reopen the board.");
}

/** `DELETE /api/boards/{board_id}` — 204, and 409 unless the board is closed. No undo. */
export function useDeleteBoard(boardId: number): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation({
    mutationFn: () => deleteBoard(boardId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: boardKey(boardId) });
      void queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
      void queryClient.invalidateQueries({ queryKey: CLOSED_BOARDS_KEY });
    },
    onError: (error) => show(errorMessage(error, "Couldn't delete the board."), 'error'),
  });
}

export interface StarVariables {
  boardId: number;
  isStarred: boolean;
}

interface StarSnapshot {
  groups: BoardGroups | undefined;
  board: BoardState | undefined;
}

/**
 * `PUT` / `DELETE /api/boards/{board_id}/star` — optimistic, because the Starred section
 * re-sorts under the pointer without a reload (Section 2.2). The star is per-user state:
 * no `board_version`, no activity and no event, so nothing is merged back on success, and
 * the server appends a new star last, exactly where `setBoardStarred` put it.
 */
export function useStarBoard(): UseMutationResult<void, Error, StarVariables, StarSnapshot> {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation({
    mutationFn: ({ boardId, isStarred }: StarVariables) =>
      isStarred ? starBoard(boardId).then(() => undefined) : unstarBoard(boardId),
    onMutate: async ({ boardId, isStarred }) => {
      await queryClient.cancelQueries({ queryKey: BOARDS_KEY });
      const groups = queryClient.getQueryData<BoardGroups>(BOARDS_KEY);
      const board = queryClient.getQueryData<BoardState>(boardKey(boardId));
      if (groups !== undefined) {
        queryClient.setQueryData<BoardGroups>(
          BOARDS_KEY,
          setBoardStarred(groups, boardId, isStarred),
        );
      }
      if (board !== undefined) {
        queryClient.setQueryData<BoardState>(boardKey(boardId), {
          ...board,
          board: { ...board.board, is_starred: isStarred },
        });
      }
      return { groups, board };
    },
    onError: (error, { boardId }, snapshot) => {
      if (snapshot?.groups !== undefined) queryClient.setQueryData(BOARDS_KEY, snapshot.groups);
      if (snapshot?.board !== undefined) {
        queryClient.setQueryData(boardKey(boardId), snapshot.board);
      }
      show(errorMessage(error, "Couldn't update your star. Try again."), 'error');
    },
  });
}
