import { useState, type ReactElement } from 'react';
import { Check } from 'lucide-react';
import { Avatar, Button, Popover, TextInput } from '@/components/ui';
import { useMe } from '@/hooks/useAuth';
import { useCard, useMembers } from '@/hooks/useBoardData';
import { useToggleCardMember } from '@/hooks/useCardMutations';
import type { MemberRow } from '@/lib/boardState';
import styles from './MembersPopover.module.css';

const NO_MEMBERS: readonly MemberRow[] = [];

export interface MembersPopoverProps {
  boardId: number;
  cardId: number;
  /** The control the panel hangs off: a sidebar row, the badge row's "+", or the quick editor. */
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
}

/**
 * "Members" (Section 2.6.5): the search box, the "Card members" rows — a click removes — and the
 * "Board members" rows below them, where a click assigns.
 *
 * Both halves are the same 40px row and the same one endpoint pair
 * (`PUT` / `DELETE /api/cards/{card_id}/members/{user_id}`), so a row carries `aria-pressed` and
 * the heading it sits under is the only difference between them: the assignment is what the
 * board cache already knows, which is why the panel opens with no request of its own from the
 * modal, from a tile's quick editor or from the badge row.
 *
 * "Join" is the same write with my own id (Section 2.6.4). It renders here as well as in the
 * sidebar, because the popover is where a reader who opened it to add somebody discovers they
 * are not on the card themselves, and it is hidden once I am a member — there is a row for
 * removing myself and two controls for one state would disagree.
 */
export function MembersPopover({
  boardId,
  cardId,
  anchor,
  onClose,
}: MembersPopoverProps): ReactElement {
  const [query, setQuery] = useState('');
  const members = useMembers(boardId).data ?? NO_MEMBERS;
  const card = useCard(boardId, cardId).data;
  const me = useMe().data;
  const toggleMember = useToggleCardMember(boardId, cardId);

  const assigned = new Set(card?.member_ids ?? []);
  const needle = query.trim().toLowerCase();
  const visible = members.filter(
    (member) =>
      member.full_name.toLowerCase().includes(needle) ||
      member.username.toLowerCase().includes(needle),
  );
  const onCard = visible.filter((member) => assigned.has(member.id));
  const offCard = visible.filter((member) => !assigned.has(member.id));

  const canJoin =
    me !== undefined && !assigned.has(me.id) && members.some((member) => member.id === me.id);

  function row(member: MemberRow, isOn: boolean): ReactElement {
    return (
      <li key={member.id}>
        <button
          type="button"
          className={styles.row}
          aria-pressed={isOn}
          onClick={() => toggleMember.mutate({ userId: member.id, assigned: !isOn })}
        >
          {/* The row already says the name, so the avatar is decorative here: its own
              `aria-label` would otherwise announce the member twice. */}
          <span aria-hidden="true">
            <Avatar name={member.full_name} color={member.avatar_color} size={32} />
          </span>
          <span className={styles.name}>{member.full_name}</span>
          {isOn ? <Check className={styles.check} aria-hidden="true" size={16} /> : null}
        </button>
      </li>
    );
  }

  return (
    <Popover anchor={anchor} title="Members" onClose={onClose}>
      <div className={styles.panel}>
        <TextInput
          placeholder="Search members"
          aria-label="Search members"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        {onCard.length === 0 ? null : (
          <>
            <p className={styles.subheading}>Card members</p>
            <ul className={styles.rows}>{onCard.map((member) => row(member, true))}</ul>
          </>
        )}

        {offCard.length === 0 ? null : (
          <>
            <p className={styles.subheading}>Board members</p>
            <ul className={styles.rows}>{offCard.map((member) => row(member, false))}</ul>
          </>
        )}

        {canJoin && me !== undefined ? (
          <Button fullWidth onClick={() => toggleMember.mutate({ userId: me.id, assigned: true })}>
            Join
          </Button>
        ) : null}
      </div>
    </Popover>
  );
}
