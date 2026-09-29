/**
 * The boards endpoints of Section 4.3: the home page's three groups, boards CRUD, the
 * close/reopen/delete state machine and stars.
 */
import { api } from './client';
import type {
  ArchivedCards,
  ArchivedLists,
  ArchivedType,
  BackgroundType,
  Board,
  BoardGroups,
  BoardSummary,
  ClosedBoards,
  Mutated,
  StarState,
} from './types';

export interface CreateBoardInput {
  name: string;
  background_type?: BackgroundType;
  /** A `^#[0-9A-Fa-f]{6}$` hex for `color`, a `/api/meta` gradient key for `gradient`. */
  background_value?: string;
  /** Seeds the lists "To Do", "Doing", "Done" (default true). */
  default_lists?: boolean;
}

/**
 * `background_image_id` re-selects an uploaded image and cannot be combined
 * with `background_type` / `background_value` in one body (422, Section 4.3).
 */
export interface UpdateBoardInput {
  name?: string;
  description?: string;
  background_type?: BackgroundType;
  background_value?: string;
  background_image_id?: number;
}

/** `GET /api/boards` — `{starred, recent, all}` for the home page. */
export function listBoards(): Promise<BoardGroups> {
  return api.get<BoardGroups>('/boards');
}

/** `GET /api/boards?closed=1` — the rows of `ClosedBoardsModal`. */
export function listClosedBoards(): Promise<ClosedBoards> {
  return api.get<ClosedBoards>('/boards?closed=1');
}

/**
 * `GET /api/boards/{board_id}` — the board document, served for a closed board too (the
 * client then renders `ClosedBoardPage`). Also refreshes the board's `board_views` row, which
 * is why it is never called speculatively.
 */
export function getBoard(boardId: number): Promise<Board> {
  return api.get<Board>(`/boards/${boardId}`);
}

/** `POST /api/boards` — 201 with the new tile. */
export function createBoard(input: CreateBoardInput): Promise<BoardSummary> {
  return api.post<BoardSummary>('/boards', input);
}

/** `PATCH /api/boards/{board_id}` — one activity row per changed field (Section 4.3). */
export function updateBoard(
  boardId: number,
  input: UpdateBoardInput,
): Promise<Mutated<BoardSummary>> {
  return api.patch<Mutated<BoardSummary>>(`/boards/${boardId}`, input);
}

/** `POST /api/boards/{board_id}/reopen` — admin only; the one mutation allowed while closed. */
export function reopenBoard(boardId: number): Promise<Mutated<BoardSummary>> {
  return api.post<Mutated<BoardSummary>>(`/boards/${boardId}/reopen`);
}

/** `POST /api/boards/{board_id}/close` — admin only; the board leaves the home groups. */
export function closeBoard(boardId: number): Promise<Mutated<BoardSummary>> {
  return api.post<Mutated<BoardSummary>>(`/boards/${boardId}/close`);
}

/** `DELETE /api/boards/{board_id}` — 204; 409 unless the board is closed. No undo. */
export function deleteBoard(boardId: number): Promise<void> {
  return api.del(`/boards/${boardId}`);
}

/** Section 4.3: one page of either archive is 50 rows. */
export const ARCHIVED_PAGE_SIZE = 50;

/** `GET /api/boards/{board_id}/archived` query (Section 4.3); `type` is the panel's switch. */
export interface ArchivedQuery {
  /** A title/name substring, `LIKE '%q%' COLLATE NOCASE` on the server. */
  q?: string;
  /** The `cards.id` / `lists.id` to page before; absent is the newest page. */
  before?: number;
  limit?: number;
}

/**
 * One URL for both halves of the archive. The two readers below differ only in the row shape
 * they promise, which is what keeps `items` typed per `type` instead of a union the caller
 * has to narrow (the server declares the pair the same way, `schemas/archived.py`).
 */
function archivedPath(boardId: number, type: ArchivedType, query: ArchivedQuery): string {
  const params = new URLSearchParams({ type, limit: String(query.limit ?? ARCHIVED_PAGE_SIZE) });
  const q = query.q?.trim() ?? '';
  if (q !== '') params.set('q', q);
  if (query.before !== undefined) params.set('before', String(query.before));
  return `/boards/${boardId}/archived?${params.toString()}`;
}

/** `?type=cards` — only cards with `is_archived = 1`, never cards inside an archived list. */
export function getArchivedCards(
  boardId: number,
  query: ArchivedQuery = {},
): Promise<ArchivedCards> {
  return api.get<ArchivedCards>(archivedPath(boardId, 'cards', query));
}

/** `?type=lists` — the archived columns, which come back with their cards when restored. */
export function getArchivedLists(
  boardId: number,
  query: ArchivedQuery = {},
): Promise<ArchivedLists> {
  return api.get<ArchivedLists>(archivedPath(boardId, 'lists', query));
}

/** `PUT /api/boards/{board_id}/star` — per-user, idempotent, allowed on a closed board. */
export function starBoard(boardId: number): Promise<StarState> {
  return api.put<StarState>(`/boards/${boardId}/star`);
}

/**
 * `DELETE /api/boards/{board_id}/star` — the 200 body is the constant `{is_starred: false}`,
 * and `client.ts`'s `del` discards bodies, so a resolved promise *is* that answer.
 */
export function unstarBoard(boardId: number): Promise<void> {
  return api.del(`/boards/${boardId}/star`);
}
