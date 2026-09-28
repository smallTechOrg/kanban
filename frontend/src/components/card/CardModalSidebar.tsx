import { useRef, useState, type ReactElement } from 'react';
import {
  Archive,
  ArrowRight,
  Check,
  CheckSquare,
  Clock,
  Copy,
  CreditCard,
  Eye,
  Image,
  Paperclip,
  Share2,
  Tag,
  Undo2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { CardDetail } from '@/api/types';
import { Button, ConfirmPopover } from '@/components/ui';
import { useMe } from '@/hooks/useAuth';
import {
  useArchiveOpenCard,
  useDeleteCard,
  useToggleCardMember,
  useToggleWatch,
  useUnarchiveOpenCard,
  useUpdateCardFields,
} from '@/hooks/useCardMutations';
import { useToast } from '@/hooks/useToast';
import { useUiStore, type OpenPopover, type PopoverKind } from '@/store/uiStore';
import { AttachmentPopover } from './AttachmentPopover';
import { ChecklistPopover } from './ChecklistPopover';
import { CopyCardPopover } from './CopyCardPopover';
import { CoverPopover } from './CoverPopover';
import { DatesPopover } from './DatesPopover';
import { LabelsPopover } from './LabelsPopover';
import { MembersPopover } from './MembersPopover';
import { MoveCardPopover } from './MoveCardPopover';
import { SharePopover } from './SharePopover';
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
 * Every row is live: the seven panels of Section 2.6.5, "Join" and "Watch" as one-shot writes,
 * "Make template" as one field of the card `PATCH`, and the archive group, which swaps Archive
 * for "Send to board" and a `danger` Delete once the card is archived — the state machine of
 * Section 3.7, where archiving is undoable for five seconds from its toast and deleting is not
 * undoable at all, so it asks first and then navigates back to the board.
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
  const { show } = useToast();
  const me = useMe().data;

  const updateCard = useUpdateCardFields(boardId, cardId);
  const toggleMember = useToggleCardMember(boardId, cardId);
  const toggleWatch = useToggleWatch(boardId, cardId);
  const archiveCard = useArchiveOpenCard(boardId, cardId);
  const unarchiveCard = useUnarchiveOpenCard(boardId, cardId);
  const deleteCard = useDeleteCard(boardId, cardId);

  function opener(kind: PopoverKind): (anchor: HTMLElement) => void {
    return (anchor) => setOpenPopover({ kind, anchor });
  }

  function close(): void {
    setOpenPopover(null);
  }

  /** Section 3.7: the modal stays open on the banner, and the toast can undo for five seconds. */
  function archive(): void {
    archiveCard.mutate();
    show('Card archived', 'neutral', { label: 'Undo', onClick: () => unarchiveCard.mutate() });
  }

  const root = rootRef.current;
  const own: OpenPopover | null =
    popover !== null &&
    popover.anchor instanceof HTMLElement &&
    root !== null &&
    root.contains(popover.anchor)
      ? popover
      : null;

  const isMember = me !== undefined && card.member_ids.includes(me.id);

  return (
    <aside className={styles.sidebar} ref={rootRef}>
      <h3 className={styles.heading}>Add to card</h3>
      {isMember || me === undefined ? null : (
        <SidebarButton
          label="Join"
          icon={<UserPlus aria-hidden="true" />}
          onClick={() => toggleMember.mutate({ userId: me.id, assigned: true })}
        />
      )}
      <SidebarButton
        label="Members"
        icon={<Users aria-hidden="true" />}
        shortcut="members"
        onClick={opener('members')}
      />
      <SidebarButton
        label="Labels"
        icon={<Tag aria-hidden="true" />}
        shortcut="labels"
        onClick={opener('labels')}
      />
      <SidebarButton
        label="Checklist"
        icon={<CheckSquare aria-hidden="true" />}
        onClick={opener('checklist')}
      />
      <SidebarButton
        label="Dates"
        icon={<Clock aria-hidden="true" />}
        shortcut="dates"
        onClick={opener('dates')}
      />
      <SidebarButton
        label="Attachment"
        icon={<Paperclip aria-hidden="true" />}
        onClick={opener('attachment')}
      />
      <SidebarButton label="Cover" icon={<Image aria-hidden="true" />} onClick={opener('cover')} />

      <h3 className={styles.heading}>Actions</h3>
      <SidebarButton
        label="Move"
        icon={<ArrowRight aria-hidden="true" />}
        onClick={opener('moveCard')}
      />
      <SidebarButton label="Copy" icon={<Copy aria-hidden="true" />} onClick={opener('copyCard')} />
      <SidebarButton
        label={card.is_template ? 'Convert to card' : 'Make template'}
        icon={<CreditCard aria-hidden="true" />}
        onClick={() => updateCard.mutate({ is_template: !card.is_template })}
      />
      {/* Section 2.6.4: the label stays "Watch" and a blue check tile sits at the row's right
          edge while I watch. The tile is beside the button, not inside it, because `SidebarButton`
          renders one <button> whose accessible name is its label. */}
      <div className={styles.watchRow}>
        <SidebarButton
          label="Watch"
          icon={<Eye aria-hidden="true" />}
          onClick={() => toggleWatch.mutate(!card.is_watching)}
        />
        {card.is_watching ? (
          <span className={styles.watchCheck}>
            <Check aria-hidden="true" size={16} />
            <span className={styles.state}>Watching this card</span>
          </span>
        ) : null}
      </div>

      <div className={styles.divider} />

      {card.is_archived ? (
        <>
          <SidebarButton
            label="Send to board"
            icon={<Undo2 aria-hidden="true" />}
            onClick={() => unarchiveCard.mutate()}
          />
          <Button
            variant="danger"
            fullWidth
            className={styles.delete}
            onClick={(event) => setConfirmAnchor(event.currentTarget)}
          >
            Delete
          </Button>
        </>
      ) : (
        <SidebarButton label="Archive" icon={<Archive aria-hidden="true" />} onClick={archive} />
      )}
      <SidebarButton label="Share" icon={<Share2 aria-hidden="true" />} onClick={opener('share')} />

      {own === null || own.kind !== 'members' ? null : (
        <MembersPopover boardId={boardId} cardId={cardId} anchor={own.anchor} onClose={close} />
      )}
      {own === null || own.kind !== 'labels' ? null : (
        <LabelsPopover boardId={boardId} cardId={cardId} anchor={own.anchor} onClose={close} />
      )}
      {own === null || own.kind !== 'checklist' ? null : (
        <ChecklistPopover boardId={boardId} cardId={cardId} anchor={own.anchor} onClose={close} />
      )}
      {own === null || own.kind !== 'dates' ? null : (
        <DatesPopover boardId={boardId} cardId={cardId} anchor={own.anchor} onClose={close} />
      )}
      {own === null || own.kind !== 'attachment' ? null : (
        <AttachmentPopover boardId={boardId} cardId={cardId} anchor={own.anchor} onClose={close} />
      )}
      {own === null || own.kind !== 'cover' ? null : (
        <CoverPopover boardId={boardId} cardId={cardId} anchor={own.anchor} onClose={close} />
      )}
      {own === null || own.kind !== 'moveCard' ? null : (
        <MoveCardPopover boardId={boardId} cardId={cardId} anchor={own.anchor} onClose={close} />
      )}
      {own === null || own.kind !== 'copyCard' ? null : (
        <CopyCardPopover boardId={boardId} cardId={cardId} anchor={own.anchor} onClose={close} />
      )}
      {own === null || own.kind !== 'share' ? null : (
        <SharePopover boardId={boardId} cardId={cardId} anchor={own.anchor} onClose={close} />
      )}

      {confirmAnchor === null ? null : (
        <ConfirmPopover
          anchor={confirmAnchor}
          title="Delete card?"
          body={DELETE_BODY}
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
