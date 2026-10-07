import { useRef, useState, type ReactElement } from 'react';
import { Clock, Tag, Undo2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { CardDetail } from '@/api/types';
import { Button, ConfirmPopover } from '@/components/ui';
import { useDeleteCard, useUnarchiveOpenCard } from '@/hooks/useCardMutations';
import { useUiStore, type OpenPopover, type PopoverKind } from '@/store/uiStore';
import { DatesPopover } from './DatesPopover';
import { LabelsPopover } from './LabelsPopover';
import { SidebarButton } from './SidebarButton';
import styles from './CardModalSidebar.module.css';

/** Section 2.6.4's confirm body, word for word: a hard delete has no undo (Section 3.7). */
const DELETE_BODY =
  'All actions will be removed from the activity feed and you won’t be able to re-open the ' +
  'card. There is no undo.';

export interface CardModalSidebarProps {
  /** The `['card', cardId]` document the modal already loaded; `board_id` comes off it. */
  card: CardDetail;
}

/**
 * The card modal's 168px sidebar (Section 2.6.4): the "Add to card" and "Actions" groups, every
 * row a `SidebarButton` that anchors its popover to itself.
 *
 * A card carries labels and dates and nothing else, so those are the two panels here; delete is
 * the one action. There is no move, no copy, no template and no cover, and items are added in
 * the main column rather than from a panel.
 *
 * Delete is a hard delete with no undo (Section 3.7), so it confirms first and then navigates
 * back to the board. A card that was archived in bulk from its list menu also offers "Send to
 * board" above it, which is the only way back from the archive.
 *
 * Which popover is open lives in `uiStore.openPopover` (Section 5.13), the one field that keeps
 * exactly one popover open across the app and lets the modal's Escape handler close a popover
 * before itself. A card modal has two places that open the same panels — this sidebar and
 * `QuickBadgesRow` — so the test for "is this mine" is whether the stored anchor is one of this
 * column's own buttons, not the popover's kind. The delete confirmation is deliberately not in
 * that store: it belongs to the Delete row that opened it and must not close the panel stack.
 */
export function CardModalSidebar({ card }: CardModalSidebarProps): ReactElement {
  const boardId = card.board_id;
  const cardId = card.id;
  const rootRef = useRef<HTMLElement>(null);
  const popover = useUiStore((state) => state.openPopover);
  const setOpenPopover = useUiStore((state) => state.setOpenPopover);
  const [confirmAnchor, setConfirmAnchor] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();

  const unarchiveCard = useUnarchiveOpenCard(boardId, cardId);
  const deleteCard = useDeleteCard(boardId, cardId);

  function opener(kind: PopoverKind): (anchor: HTMLElement) => void {
    return (anchor) => setOpenPopover({ kind, anchor });
  }

  function close(): void {
    setOpenPopover(null);
  }

  const root = rootRef.current;
  const own: OpenPopover | null =
    popover !== null &&
    popover.anchor instanceof HTMLElement &&
    root !== null &&
    root.contains(popover.anchor)
      ? popover
      : null;

  return (
    <aside className={styles.sidebar} ref={rootRef}>
      <h3 className={styles.heading}>Add to card</h3>
      <SidebarButton
        label="Labels"
        icon={<Tag aria-hidden="true" />}
        shortcut="labels"
        onClick={opener('labels')}
      />
      <SidebarButton
        label="Dates"
        icon={<Clock aria-hidden="true" />}
        shortcut="dates"
        onClick={opener('dates')}
      />

      <h3 className={styles.heading}>Actions</h3>
      {card.is_archived ? (
        <SidebarButton
          label="Put back"
          icon={<Undo2 aria-hidden="true" />}
          onClick={() => unarchiveCard.mutate()}
        />
      ) : null}
      <Button
        variant="danger"
        fullWidth
        className={styles.delete}
        onClick={(event) => setConfirmAnchor(event.currentTarget)}
      >
        Delete
      </Button>

      {own === null || own.kind !== 'labels' ? null : (
        <LabelsPopover boardId={boardId} cardId={cardId} anchor={own.anchor} onClose={close} />
      )}
      {own === null || own.kind !== 'dates' ? null : (
        <DatesPopover boardId={boardId} cardId={cardId} anchor={own.anchor} onClose={close} />
      )}

      {confirmAnchor === null ? null : (
        <ConfirmPopover
          anchor={confirmAnchor}
          title="Delete card?"
          body={DELETE_BODY}
          confirmLabel="Delete card"
          loading={deleteCard.isPending}
          onClose={() => setConfirmAnchor(null)}
          onConfirm={() =>
            deleteCard.mutate(undefined, {
              onSuccess: () => navigate(`/b/${String(boardId)}`, { replace: true }),
            })
          }
        />
      )}
    </aside>
  );
}
