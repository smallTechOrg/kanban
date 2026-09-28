import { useState, type ReactElement } from 'react';
import type { CopyKeep } from '@/api/cards';
import type { CardDetail } from '@/api/types';
import { Button, Checkbox, Field, Popover, Spinner, Textarea, Tooltip } from '@/components/ui';
import { useCardDetail } from '@/hooks/useCard';
import { useCopyCard, type CopyCardVariables } from '@/hooks/useCardMutations';
import { DestinationSelects, type Destination } from './DestinationSelects';
import styles from './CopyCardPopover.module.css';

/** Section 2.6.5, on the two keeps the server drops whatever the client sends (Section 4.5). */
const CROSS_BOARD_TOOLTIP = "Labels and members can't be copied to another board";

/** The five "Keep…" flags, in the order Section 2.6.5 lists them. */
const KEEPS: readonly { key: keyof CopyKeep; label: string }[] = [
  { key: 'checklists', label: 'Checklists' },
  { key: 'labels', label: 'Labels' },
  { key: 'members', label: 'Members' },
  { key: 'attachments', label: 'Attachments' },
  { key: 'comments', label: 'Comments' },
];

/** Every flag starts ticked: Trello's default, and the opposite of the API's (Section 4.5). */
const ALL_KEPT: Required<CopyKeep> = {
  labels: true,
  members: true,
  checklists: true,
  attachments: true,
  comments: true,
};

/** What the card actually carries; a row with nothing to keep is not rendered at all. */
function keepCounts(card: CardDetail): Record<keyof CopyKeep, number> {
  return {
    checklists: card.checklists.length,
    labels: card.label_ids.length,
    members: card.member_ids.length,
    attachments: card.attachments.length,
    comments: card.badges.comments,
  };
}

interface CopyFormProps {
  boardId: number;
  card: CardDetail;
  onCopy: (variables: CopyCardVariables) => void;
}

/**
 * The body of the "Copy card" panel: the title, the keeps and the destination.
 *
 * It is its own component for the reason `DatesForm` is: the title has to be seeded from the
 * card exactly once, and the card arrives from `['card', id]` after the panel has opened.
 */
function CopyForm({ boardId, card, onCopy }: CopyFormProps): ReactElement {
  const [title, setTitle] = useState(card.title);
  const [keep, setKeep] = useState<Required<CopyKeep>>(ALL_KEPT);
  const [destination, setDestination] = useState<Destination | null>(null);

  const counts = keepCounts(card);
  // The server never keeps labels or members across boards, so the popover says so rather than
  // sending flags it would ignore (Section 4.5).
  const crossBoard = destination !== null && destination.boardId !== boardId;
  const isBlocked = (key: keyof CopyKeep): boolean =>
    crossBoard && (key === 'labels' || key === 'members');

  function create(): void {
    const name = title.trim();
    if (name === '' || destination === null) return;
    onCopy({
      title: name,
      toListId: destination.listId,
      index: destination.index,
      // Every flag explicitly, and only for data the copy can actually carry (Section 2.6.5).
      keep: Object.fromEntries(
        KEEPS.map(({ key }) => [key, keep[key] && counts[key] > 0 && !isBlocked(key)]),
      ) as Required<CopyKeep>,
    });
  }

  return (
    <div className={styles.body}>
      <Field label="Title">
        {(control) => (
          <Textarea
            {...control}
            value={title}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setTitle(event.target.value)}
            onSubmit={create}
          />
        )}
      </Field>

      {KEEPS.every(({ key }) => counts[key] === 0) ? null : (
        <div className={styles.keeps}>
          <h4 className={styles.heading}>Keep…</h4>
          {KEEPS.filter(({ key }) => counts[key] > 0).map(({ key, label }) => {
            const row = (
              <Checkbox
                label={`${label} (${String(counts[key])})`}
                checked={keep[key] && !isBlocked(key)}
                disabled={isBlocked(key)}
                onChange={(event) => setKeep({ ...keep, [key]: event.target.checked })}
              />
            );
            return isBlocked(key) ? (
              <Tooltip key={key} content={CROSS_BOARD_TOOLTIP} placement="right">
                {row}
              </Tooltip>
            ) : (
              <div key={key}>{row}</div>
            );
          })}
        </div>
      )}

      <h4 className={styles.heading}>Copy to…</h4>
      <DestinationSelects boardId={boardId} listId={card.list_id} onChange={setDestination} />

      <Button
        variant="primary"
        disabled={destination === null || title.trim() === ''}
        onClick={create}
      >
        Create card
      </Button>
    </div>
  );
}

export interface CopyCardPopoverProps {
  boardId: number;
  cardId: number;
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
}

/**
 * "Copy card" (Section 2.6.5), opened from the sidebar's Copy row and the quick editor.
 *
 * Nothing is optimistic: the server decides what the copy contains, down to duplicating the
 * attachment files, so the new tile arrives with the response (`useCopyCard`). Like the move, it
 * sends the index form only and never neighbour ids (Section 4.9).
 */
export function CopyCardPopover({
  boardId,
  cardId,
  anchor,
  onClose,
}: CopyCardPopoverProps): ReactElement {
  const card = useCardDetail(cardId).data;
  const copyCard = useCopyCard(boardId, cardId);

  return (
    <Popover anchor={anchor} title="Copy card" onClose={onClose}>
      {card === undefined ? (
        <Spinner />
      ) : (
        <CopyForm
          boardId={boardId}
          card={card}
          onCopy={(variables) => {
            copyCard.mutate(variables);
            onClose();
          }}
        />
      )}
    </Popover>
  );
}
