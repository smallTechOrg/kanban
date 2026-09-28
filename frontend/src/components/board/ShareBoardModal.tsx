import { useState, type MouseEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BoardRole, PublicUser } from '@/api/types';
import {
  Avatar,
  Button,
  ConfirmPopover,
  Field,
  Modal,
  Select,
  TextInput,
  Tooltip,
} from '@/components/ui';
import { useMe } from '@/hooks/useAuth';
import { useBoardMeta, useMembers } from '@/hooks/useBoardData';
import { useRemoveBoardMember, useSetBoardMemberRole } from '@/hooks/useBoardMembers';
import { MIN_USER_QUERY_LENGTH, useUserSearch } from '@/hooks/useUsers';
import type { Id, MemberRow } from '@/lib/boardState';
import styles from './ShareBoardModal.module.css';

/** Section 2.3.1: the Share dialog is 600px, not the 768px default. */
const WIDTH = 600;

/** The roles of Section 4.1, widest access last, as the selects list them. */
const ROLES: readonly BoardRole[] = ['admin', 'member', 'observer'];

/** What each role is called in the selects and in the read-only rows. */
const ROLE_NAMES: Record<BoardRole, string> = {
  admin: 'Admin',
  member: 'Member',
  observer: 'Observer',
};

/** `PUT /api/boards/{board_id}/members/{user_id}` defaults to `member` (Section 4.3). */
const DEFAULT_ROLE: BoardRole = 'member';

/** Why the last admin's role select and their "Leave board" row are not offered. */
const LAST_ADMIN = 'A board needs at least one admin';

/** A `<select>` hands back a string; this keeps the state honest without a cast. */
function toRole(value: string): BoardRole {
  return ROLES.find((role) => role === value) ?? DEFAULT_ROLE;
}

export interface ShareBoardModalProps {
  boardId: number;
  onClose: () => void;
}

/**
 * "Share board" (Section 2.3.1): the directory search that adds a member at a chosen role, the
 * board's current members with a role select and "Remove", and "Leave board" on the caller's own
 * row.
 *
 * Adding a member and changing a role are the same idempotent `PUT` (Section 4.3), so one
 * mutation serves the "Add" button and every role select. Both are admin-only endpoints, which
 * is why a non-admin reader gets the list read-only — no search box, the role as plain text and
 * no "Remove" — rather than controls that would fail with a 403 after the click. The caller's own
 * row keeps its action in that mode, because leaving a board is the one membership write any
 * member may make.
 *
 * The last admin cannot be demoted or removed (409 `conflict` from the server), so their role
 * select is disabled with the reason and their row offers no way out at all.
 */
export function ShareBoardModal({ boardId, onClose }: ShareBoardModalProps): ReactElement | null {
  const navigate = useNavigate();
  const { data: board } = useBoardMeta(boardId);
  const { data: members } = useMembers(boardId);
  const { data: me } = useMe();
  const setRole = useSetBoardMemberRole(boardId);
  const removeMember = useRemoveBoardMember(boardId);
  const [query, setQuery] = useState('');
  const [drafts, setDrafts] = useState<Record<Id, BoardRole>>({});
  const [leaveAnchor, setLeaveAnchor] = useState<HTMLElement | null>(null);

  const canManage = board?.my_role === 'admin';
  // The search is the admin-only half of the dialog, so a read-only reader sends nothing: an
  // empty term is below the two characters `GET /api/users` needs (Section 4.2).
  const search = useUserSearch(canManage ? query : '');

  const rows = members ?? [];
  const memberIds = new Set(rows.map((member) => member.id));
  // Somebody already on the board is not a candidate: their row below is where their role
  // changes, so the same person can never appear in both halves of the dialog.
  const candidates = search.users.filter((user) => !memberIds.has(user.id));
  const adminCount = rows.filter((member) => member.role === 'admin').length;

  if (board === undefined) return null;

  function draftRole(userId: Id): BoardRole {
    return drafts[userId] ?? DEFAULT_ROLE;
  }

  function add(user: PublicUser): void {
    setRole.mutate({ userId: user.id, role: draftRole(user.id) });
  }

  function leave(): void {
    if (me === undefined) return;
    removeMember.mutate(me.id, {
      onSuccess: () => {
        setLeaveAnchor(null);
        onClose();
        navigate('/');
      },
    });
  }

  function memberAction(member: MemberRow, isLastAdmin: boolean): ReactElement | null {
    if (me !== undefined && member.id === me.id) {
      if (isLastAdmin) return null;
      return (
        <Button
          variant="link"
          onClick={(event: MouseEvent<HTMLButtonElement>) => setLeaveAnchor(event.currentTarget)}
        >
          Leave board
        </Button>
      );
    }
    if (!canManage) return null;
    return (
      <Button
        variant="link"
        aria-label={`Remove ${member.full_name} from this board`}
        onClick={() => removeMember.mutate(member.id)}
      >
        Remove
      </Button>
    );
  }

  return (
    <Modal title="Share board" width={WIDTH} onClose={onClose}>
      {canManage ? (
        <div className={styles.search}>
          <Field
            label="Add members"
            helper={`Type at least ${String(MIN_USER_QUERY_LENGTH)} characters of a name or username.`}
          >
            {(control) => (
              <TextInput
                {...control}
                type="search"
                value={query}
                placeholder="Search people"
                onChange={(event) => setQuery(event.target.value)}
              />
            )}
          </Field>

          {search.isEnabled && candidates.length === 0 && !search.isFetching ? (
            <p className={styles.empty}>{`Nobody else matches “${search.term}”.`}</p>
          ) : null}

          <ul className={styles.rows}>
            {candidates.map((user) => (
              <li className={styles.row} key={user.id}>
                <span aria-hidden="true">
                  <Avatar name={user.full_name} color={user.avatar_color} size={32} />
                </span>
                <span className={styles.who}>
                  <span className={styles.name}>{user.full_name}</span>
                  <span className={styles.username}>{`@${user.username}`}</span>
                </span>
                <Select
                  aria-label={`Role for ${user.full_name}`}
                  value={draftRole(user.id)}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [user.id]: toRole(event.target.value) }))
                  }
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_NAMES[role]}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="primary"
                  aria-label={`Add ${user.full_name} to this board`}
                  onClick={() => add(user)}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <h3 className={styles.heading}>Board members</h3>
      <ul className={styles.rows}>
        {rows.map((member) => {
          const isLastAdmin = member.role === 'admin' && adminCount === 1;
          const roleSelect = (
            <Select
              aria-label={`Role for ${member.full_name}`}
              value={member.role}
              disabled={isLastAdmin}
              onChange={(event) =>
                setRole.mutate({ userId: member.id, role: toRole(event.target.value) })
              }
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_NAMES[role]}
                </option>
              ))}
            </Select>
          );

          return (
            <li className={styles.row} key={member.id}>
              <span aria-hidden="true">
                <Avatar name={member.full_name} color={member.avatar_color} size={32} />
              </span>
              <span className={styles.who}>
                <span className={styles.name}>{member.full_name}</span>
                <span className={styles.username}>{`@${member.username}`}</span>
              </span>
              {canManage ? (
                isLastAdmin ? (
                  <Tooltip content={LAST_ADMIN}>{roleSelect}</Tooltip>
                ) : (
                  roleSelect
                )
              ) : (
                <span className={styles.role}>{ROLE_NAMES[member.role]}</span>
              )}
              {memberAction(member, isLastAdmin)}
            </li>
          );
        })}
      </ul>

      {leaveAnchor === null ? null : (
        <ConfirmPopover
          anchor={leaveAnchor}
          title="Leave board?"
          body="You will lose access to this board until an admin adds you again."
          confirmLabel="Leave"
          loading={removeMember.isPending}
          onConfirm={leave}
          onClose={() => setLeaveAnchor(null)}
        />
      )}
    </Modal>
  );
}
