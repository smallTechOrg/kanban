/**
 * The board background endpoints of Section 4.3: the picker's preset-plus-library view and the
 * custom image upload behind its "Custom" tab.
 *
 * *Choosing* a background is not here: a colour, a gradient and an already-uploaded image are all
 * `PATCH /api/boards/{board_id}` (`api/boards.ts` `updateBoard`), which is the same write as a
 * rename. Only the upload has a route of its own, because only it carries bytes.
 */
import { api, uploadFile, type UploadOptions } from './client';
import type { BoardBackgrounds, BoardSummary, Mutated } from './types';

/**
 * `GET /api/boards/{board_id}/backgrounds` — the `/api/meta` colour and gradient presets plus
 * the caller's own uploaded library, in one round trip for `BoardBackgroundPicker`.
 */
export function getBackgrounds(boardId: number): Promise<BoardBackgrounds> {
  return api.get<BoardBackgrounds>(`/boards/${boardId}/backgrounds`);
}

/**
 * `POST /api/boards/{board_id}/background`, multipart `file` — stores the image in the caller's
 * library and makes it this board's background in one write, so the answer is the board row.
 *
 * The 10 MB cap, the PNG/JPEG/WebP rule and the sniffing behind it are all the server's
 * (Section 6.9): it answers 413 and 415 with the sentence the toast shows, which is why no
 * second copy of either limit is written down here.
 */
export function uploadBackground(
  boardId: number,
  file: File,
  options: UploadOptions = {},
): Promise<Mutated<BoardSummary>> {
  return uploadFile<Mutated<BoardSummary>>(`/boards/${boardId}/background`, file, options);
}
