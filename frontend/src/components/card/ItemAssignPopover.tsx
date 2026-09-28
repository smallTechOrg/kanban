import { useState, type ReactElement } from 'react';
import { Check } from 'lucide-react';
import type { ChecklistItem } from '@/api/types';
import { Avatar, Popover, TextInput } from '@/components/ui';
import { useMembers } from '@/hooks/useBoardData';
import { useUpdateChecklistItem } from '@/hooks/useCardMutations';
import type { MemberRow } from '@/lib/boardState';
import styles from './ItemAssignPopover.module.css';

const NO_MEMBERS: readonly MemberRow[] = [];

export interface ItemAssignPopoverProps {
  boardId: number;
  cardId: number;
  item: ChecklistItem;
  /** The row's person `IconButton`. */
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
}

/**
 * "Assign" (Section 2.6.5): the board's members as rows, the search box that filters them, and
 * one `PATCH /api/checklist-items/{item_id}` `{assignee_id}` per click — `null` when the row that
 * is already assigned is clicked again.
 *
 * The rows come from the board payload the page already holds, so the panel opens with no request
 * of its own; the endpoint rejects a non-member (400), which is why no other list is offered.
 */
export function ItemAssignPopover({
  boardId,
  cardId,
  item,
  anchor,
  onClose,
}: ItemAssignPopoverProps): ReactElement {
  const [query, setQuery] = useState('');
  const members = useMembers(boardId).data ?? NO_MEMBERS;
  const update = useUpdateChecklistItem(boardId, cardId);

  const needle = query.trim().toLowerCase();
  const visible = members.filter(
    (member) =>
      member.full_name.toLowerCase().includes(needle) ||
      member.username.toLowerCase().includes(needle),
  );

  function toggle(member: MemberRow): void {
    const assigned = item.assignee_id === member.id;
    update.mutate({ itemId: item.id, assignee_id: assigned ? null : member.id });
    onClose();
  }

  return (
    <Popover anchor={anchor} title="Assign" onClose={onClose}>
      <div className={styles.panel}>
        <TextInput
          placeholder="Search members"
          aria-label="Search members"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <ul className={styles.rows}>
          {visible.map((member) => {
            const assigned = item.assignee_id === member.id;
            return (
              <li key={member.id}>
                <button
                  type="button"
                  className={styles.row}
                  // The avatar carries the same name, so without this the row would announce
                  // "Asha Rao Asha Rao"; naming the button explicitly wins over its contents.
                  aria-label={member.full_name}
                  aria-pressed={assigned}
                  onClick={() => toggle(member)}
                >
                  <Avatar name={member.full_name} color={member.avatar_color} size={32} />
                  <span className={styles.name}>{member.full_name}</span>
                  {assigned ? <Check className={styles.check} aria-hidden="true" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Popover>
  );
}
