/**
 * Pure helpers behind the home page's board list and tiles (Section 2.2).
 *
 * lib/ depends on no other layer, so the board shapes are declared structurally here
 * instead of imported from api/types.ts (the same arrangement lib/colors.ts uses).
 */

/** The fields a helper needs to identify a board in the cached list. */
export interface GroupableBoard {
  id: number;
  name: string;
}

/** The one group `GET /api/boards` returns, as the home page caches it. */
export interface BoardGrouping<T extends GroupableBoard> {
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
 * The board's name as the `['boards']` cache already knows it, for the board page's loading
 * header (Section 2.10): arriving from the home page shows the name immediately
 * instead of an empty band. `undefined` when that cache has never been filled or does not
 * hold this board — a direct deep link.
 */
export function boardNameFromGroups<T extends GroupableBoard>(
  groups: BoardGrouping<T> | undefined,
  boardId: number,
): string | undefined {
  return groups?.all.find((board) => board.id === boardId)?.name;
}
