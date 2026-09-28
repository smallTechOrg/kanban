/**
 * The board background library query and the custom upload (Sections 2.3.4 and 4.3).
 *
 * Choosing a preset or re-selecting a library image is `useUpdateBoard` — the same
 * `PATCH /api/boards/{board_id}` a rename sends — so this module holds only the two things that
 * endpoint cannot do: reading the caller's library, and putting an image on the wire.
 */
import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { getBackgrounds, uploadBackground } from '@/api/backgrounds';
import type { BoardBackgrounds, BoardSummary, Mutated } from '@/api/types';
import type { BoardState } from '@/lib/boardState';
import { errorMessage } from './mutationErrors';
import { boardKey } from './useBoardData';
import { BOARDS_KEY } from './useBoards';
import { useToast } from './useToast';

/** The only key Section 5.4.1 gives this module; the other two are their owners' (5.4.3). */
const backgroundsKey = (boardId: number) => ['backgrounds', boardId] as const;

/** What the picker's Upload tile shows while bytes are on the wire. */
export interface UploadBackgroundResult {
  upload: (file: File) => void;
  isUploading: boolean;
}

/**
 * `GET /api/boards/{board_id}/backgrounds` — the nine colours, four gradients and the caller's
 * uploaded images. The presets are the server's `constants.py` palettes, never a second copy.
 */
export function useBackgrounds(boardId: number): UseQueryResult<BoardBackgrounds, Error> {
  return useQuery({
    queryKey: backgroundsKey(boardId),
    queryFn: () => getBackgrounds(boardId),
  });
}

/**
 * `POST /api/boards/{board_id}/background` — the "Custom" tab's Upload tile (Section 2.3.4).
 *
 * The one board write that cannot be optimistic: the image has no id, no stored path and no
 * thumbnail until the bytes have arrived and Pillow has cropped them (Section 6.9). Instead of a
 * fake row the tile shows a spinner while `isUploading`, and the response — the authoritative
 * `BoardSummary` — is written into the board document exactly as `useUpdateBoard` writes a
 * preset choice, so the page repaints on the same path whichever way the background was chosen.
 *
 * Three caches move: the board document (its `board` row *is* the response), the home groups
 * (the tile's thumbnail changed) and this board's library (it has one image more).
 *
 * The size and type limits are deliberately not restated here. `max_upload_mb` in `['meta']` is
 * the *attachment* cap, and a background's 10 MB is the server's own number; it answers 413 and
 * 415 with the sentence to show, so a second guard would be a second copy of a rule that would
 * then be free to drift.
 */
export function useUploadBackground(boardId: number): UploadBackgroundResult {
  const queryClient = useQueryClient();
  const { show } = useToast();
  // A count rather than a flag: the first file to finish must not clear the tile while a
  // second is still queued behind it.
  const [inFlight, setInFlight] = useState(0);
  // One chain, so a second pick queues behind whatever is already on the wire.
  const queue = useRef<Promise<void>>(Promise.resolve());

  const { mutateAsync } = useMutation({
    mutationFn: (file: File) => uploadBackground(boardId, file),
    onSuccess: ({ item }: Mutated<BoardSummary>) => {
      queryClient.setQueryData<BoardState>(boardKey(boardId), (previous) =>
        previous === undefined ? undefined : { ...previous, board: item },
      );
      void queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
      void queryClient.invalidateQueries({ queryKey: backgroundsKey(boardId) });
    },
    onError: (error: unknown) =>
      show(
        errorMessage(error, "Couldn't upload that image. Try a smaller PNG, JPEG or WebP."),
        'error',
      ),
  });

  const upload = useCallback(
    (file: File) => {
      setInFlight((count) => count + 1);
      queue.current = queue.current
        .then(() => mutateAsync(file))
        .then(
          () => undefined,
          () => undefined, // the toast in `onError` is the whole failure path
        )
        .finally(() => setInFlight((count) => count - 1));
    },
    [mutateAsync],
  );

  return { upload, isUploading: inFlight > 0 };
}
