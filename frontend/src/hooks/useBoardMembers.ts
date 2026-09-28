/**
 * The two board-membership mutations behind `ShareBoardModal` (Section 2.3.1): add somebody or
 * change their role, and remove somebody or leave the board yourself.
 *
 * Who a board's members *are* is not a query of its own: the board document carries `members[]`,
 * so `useMembers` (`hooks/useBoardData.ts`) reads them out of `['board', boardId]` and these two
 * writes land in that same entry. The `PUT` answers with the authoritative `MemberOut` and a
 * `board_version`, so it is merged (`applyMemberRow`, the one reducer that writes a member row);
 * the `DELETE` answers 204 with no version, which is the documented case for a refetch
 * (Section 5.4.3).
 *
 * Neither is optimistic. Both are form submits inside a modal rather than a direct manipulation
 * of the board — the same shape as `useUpdateBoard` and `useCreateBoard`, which also let the
 * server's answer be the change the reader sees — and the 409 of "a board must keep at least one
 * admin" is a refusal a rolled-back optimistic row would have flashed past.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { removeBoardMember, setBoardMemberRole } from '@/api/boardMembers';
import type { BoardRole, Member, Mutated } from '@/api/types';
import { applyMemberRow, setBoardVersion, type BoardState } from '@/lib/boardState';
import { boardKey, invalidateBoard } from './useBoardData';
import { errorMessage } from './mutationErrors';
import { useToast } from './useToast';

export interface SetMemberRoleVariables {
  userId: number;
  role: BoardRole;
}

/**
 * `PUT /api/boards/{board_id}/members/{user_id}` — admin only, and idempotent, so the "Add"
 * button of a search row and the role select of a member row send the same request.
 */
export function useSetBoardMemberRole(
  boardId: number,
): UseMutationResult<Mutated<Member>, Error, SetMemberRoleVariables> {
  const queryClient = useQueryClient();
  const { show } = useToast();

  return useMutation({
    mutationFn: ({ userId, role }: SetMemberRoleVariables) =>
      setBoardMemberRole(boardId, userId, role),
    onSuccess: ({ item, board_version }) => {
      queryClient.setQueryData<BoardState>(boardKey(boardId), (previous) =>
        previous === undefined
          ? undefined
          : setBoardVersion(applyMemberRow(previous, item), board_version),
      );
    },
    onError: (error) => show(errorMessage(error, "Couldn't update that member."), 'error'),
  });
}

/**
 * `DELETE /api/boards/{board_id}/members/{user_id}` — "Remove" for an admin and "Leave board"
 * for the caller. The caller's own removal ends with a navigation to `/`, where `['boards']`
 * (which carries no `staleTime`, Section 5.4.1) refetches without this board of its own accord.
 */
export function useRemoveBoardMember(boardId: number): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();
  const { show } = useToast();

  return useMutation({
    mutationFn: (userId: number) => removeBoardMember(boardId, userId),
    onSuccess: () => invalidateBoard(queryClient, boardId),
    onError: (error) => show(errorMessage(error, "Couldn't remove that member."), 'error'),
  });
}
