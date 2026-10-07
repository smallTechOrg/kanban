/**
 * The one mapping from a failed request to the message a red toast shows (Section 2.10).
 *
 * `hooks/useBoards.ts`, `hooks/useBoardMutations.ts` and `hooks/useCardMutations.ts` all report
 * the same two cases — a closed board or another conflict the server worded itself, and the 503
 * a busy write lock answers — so the rule lives here once instead of in each of them
 * (CLAUDE.md section 3), which is where it moved when the card modal became the third caller.
 *
 * Everything else keeps the caller's own fallback, because only the caller knows what the user
 * was trying to do ("Couldn't move card. Try again.").
 */
import { ApiError } from '@/api/client';

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return error.message;
    if (error.status === 503) return 'The space is busy, please retry.';
  }
  return fallback;
}
