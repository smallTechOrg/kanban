/**
 * Pure helpers behind the home page's board groups and tiles (Section 2.2).
 *
 * lib/ depends on no other layer, so the board shapes are declared structurally here
 * instead of imported from api/types.ts (the same arrangement lib/colors.ts uses).
 */

/** The fields a helper needs to place a board in a group. */
export interface GroupableBoard {
  id: number;
  name: string;
  is_starred: boolean;
}

/** The three groups `GET /api/boards` returns, as the home page caches them. */
export interface BoardGrouping<T extends GroupableBoard> {
  starred: T[];
  recent: T[];
  all: T[];
}

/**
 * Alphabetical, case-insensitive, ties broken by id — the client-side equivalent of the
 * server's `ORDER BY name COLLATE NOCASE` (Section 4.3). Returns a new array.
 */
export function sortBoardsByName<T extends { id: number; name: string }>(boards: T[]): T[] {
  return [...boards].sort(
    (left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id - right.id,
  );
}

/**
 * Applies a star or unstar to every cached copy of one board: the flag flips wherever the
 * tile appears, and the tile enters or leaves the Starred group. `recent` and `all`
 * membership never changes — only the flag its `StarButton` reads.
 */
export function setBoardStarred<T extends GroupableBoard>(
  groups: BoardGrouping<T>,
  boardId: number,
  isStarred: boolean,
): BoardGrouping<T> {
  const withFlag = (board: T): T =>
    board.id === boardId ? { ...board, is_starred: isStarred } : board;
  const recent = groups.recent.map(withFlag);
  const all = groups.all.map(withFlag);
  const starred = isStarred
    ? appendStarred(groups.starred.map(withFlag), boardId, [...recent, ...all])
    : groups.starred.filter((board) => board.id !== boardId);
  return { starred, recent, all };
}

/**
 * The server inserts a new star at `max(position) + 65536`, so the optimistic tile lands
 * last. A board that is already starred, or that no other group holds, leaves it untouched.
 */
function appendStarred<T extends GroupableBoard>(starred: T[], boardId: number, known: T[]): T[] {
  if (starred.some((board) => board.id === boardId)) return starred;
  const board = known.find((candidate) => candidate.id === boardId);
  return board === undefined ? starred : [...starred, board];
}

/** The background fields of a `BoardSummary`, all a tile needs to paint itself. */
export interface BoardBackgroundFields {
  background_type: 'color' | 'gradient' | 'image';
  background_value: string;
  background_thumb_url: string | null;
}

/** A runtime-computed background, the one case Section 5 allows an inline style. */
export interface BackgroundStyle {
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
}

/** The default board colour, named by its token rather than written out (CLAUDE.md section 3). */
const FALLBACK_BACKGROUND = 'var(--primary)';

/**
 * The style for a board tile, header or picker preview. Colours are hexes straight from
 * the board row, gradients are CSS resolved from `meta.board_gradients`, and image
 * backgrounds use the 400x240 thumbnail rather than the full-size upload (Section 2.2).
 */
export function boardBackgroundStyle(
  board: BoardBackgroundFields,
  gradients: Readonly<Record<string, string>>,
): BackgroundStyle {
  if (board.background_type === 'image') {
    return {
      backgroundImage: `url("${board.background_thumb_url ?? board.background_value}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  if (board.background_type === 'gradient') {
    const css = gradients[board.background_value];
    return css === undefined ? { backgroundColor: FALLBACK_BACKGROUND } : { backgroundImage: css };
  }
  return { backgroundColor: board.background_value };
}

/**
 * The initials the server stores on a user (first letters of the first two words,
 * upper-cased, Section 4.2), for names that arrive without them — a workspace badge
 * ("K" with `letters = 1`) or an optimistic row.
 */
export function initialsFromName(name: string, letters = 2): string {
  return name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, letters)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase();
}

/**
 * The board's name as the `['boards']` cache already knows it, for the board page's loading
 * header (Section 2.10): a user who arrived from the home page sees the name immediately
 * instead of an empty band. `undefined` when that cache has never been filled or does not
 * hold this board — a direct deep link.
 */
export function boardNameFromGroups<T extends GroupableBoard>(
  groups: BoardGrouping<T> | undefined,
  boardId: number,
): string | undefined {
  if (groups === undefined) return undefined;
  const found = [...groups.starred, ...groups.recent, ...groups.all].find(
    (board) => board.id === boardId,
  );
  return found?.name;
}
