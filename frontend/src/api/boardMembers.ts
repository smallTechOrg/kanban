/**
 * The two board-membership writes of Section 4.3: `PUT` and `DELETE`
 * `/api/boards/{board_id}/members/{user_id}` — "Add", the role select and "Remove" of
 * `ShareBoardModal`, plus "Leave board" (Section 2.3.1).
 *
 * They are a module of their own for the reason `api/members.ts` is one for a card's members: a
 * board member is a row addressed by a *user* id, not by the board document `api/boards.ts`
 * reads and writes as a whole. `GET /api/boards/{board_id}/members` has no function here
 * because no caller needs it — the board payload already carries `members[]`, which
 * `useMembers` selects out of the `['board', boardId]` cache.
 *
 * Adding a member and changing a role are the same idempotent `PUT` (Section 4.3), so one
 * function serves both; `DELETE` answers 204 and is idempotent too.
 */
import { api } from './client';
import type { BoardRole, Member, Mutated } from './types';

/**
 * `PUT /api/boards/{board_id}/members/{user_id}` — admin only. 404 when no such user exists,
 * and 409 `conflict` when it would demote the last admin.
 */
export function setBoardMemberRole(
  boardId: number,
  userId: number,
  role: BoardRole,
): Promise<Mutated<Member>> {
  return api.put<Mutated<Member>>(`/boards/${boardId}/members/${userId}`, { role });
}

/**
 * `DELETE /api/boards/{board_id}/members/{user_id}` — 204. An admin removing somebody else, or
 * the caller leaving the board (allowed even while it is closed, Section 4.1). 409 for the last
 * admin, 403 when a non-admin aims at another member.
 */
export function removeBoardMember(boardId: number, userId: number): Promise<void> {
  return api.del(`/boards/${boardId}/members/${userId}`);
}
