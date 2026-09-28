import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Archive, ArrowRight, Clock, Copy, CreditCard, Image, Tag, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, Textarea } from '@/components/ui';
import { CopyCardPopover } from '@/components/card/CopyCardPopover';
import { CoverPopover } from '@/components/card/CoverPopover';
import { DatesPopover } from '@/components/card/DatesPopover';
import { LabelsPopover } from '@/components/card/LabelsPopover';
import { MembersPopover } from '@/components/card/MembersPopover';
import { MoveCardPopover } from '@/components/card/MoveCardPopover';
import { useArchiveCard, useUnarchiveCard, useUpdateCard } from '@/hooks/useBoardMutations';
import { useToast } from '@/hooks/useToast';
import type { CardRow } from '@/lib/boardState';
import { useUiStore, type OpenPopover, type PopoverKind } from '@/store/uiStore';
import styles from './QuickCardEditor.module.css';

/** Section 2.5.4: the 8px gap between the cloned tile and the action stack. */
const GAP = 8;

/** The stack flips to the left of the card when it is within 200px of the viewport's edge. */
const SIDE_WIDTH = 200;

export interface QuickCardEditorProps {
  boardId: number;
  card: CardRow;
  /** The tile the pencil belongs to; the clone is drawn over its exact box. */
  anchor: HTMLElement;
  onClose: () => void;
}

interface SideAction {
  label: string;
  icon: ReactNode;
  /** Receives the button, which is the anchor of the popover it opens (Section 2.5.4). */
  onClick: (anchor: HTMLElement) => void;
}

/**
 * The pencil overlay of Section 2.5.4: the tile is cloned in place over a dark backdrop, its
 * title becomes an editable textarea, and the actions that would otherwise need the card modal
 * sit in a stack beside it.
 *
 * Six of the eight actions open the very popovers the card modal's sidebar opens (Section 2.6.5),
 * anchored to their own button — labels, members, cover, move, copy and dates — while the title
 * edit, "Open card" and "Archive" with its five-second Undo toast need no popover at all
 * (Sections 2.5.5 and 3.7). Nothing here is a second implementation of those panels: they take a
 * board and a card id and read what they need themselves, which is why the quick editor can show
 * them from a `CardRow` with no card detail loaded.
 */
export function QuickCardEditor({
  boardId,
  card,
  anchor,
  onClose,
}: QuickCardEditorProps): ReactElement {
  // The box is read once: the clone must not chase the tile if the board scrolls behind it.
  const [box] = useState(() => anchor.getBoundingClientRect());
  const [title, setTitle] = useState(card.title);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const popover = useUiStore((state) => state.openPopover);
  const setOpenPopover = useUiStore((state) => state.setOpenPopover);
  const navigate = useNavigate();
  const { show } = useToast();
  const updateCard = useUpdateCard(boardId);
  const archiveCard = useArchiveCard(boardId);
  const unarchiveCard = useUnarchiveCard(boardId);

  useEffect(() => {
    const node = textareaRef.current;
    if (node === null) return;
    node.focus();
    // `E` puts the caret at the end, `T` selects the whole title (Section 2.8).
    const start = useUiStore.getState().quickEditSelectsTitle ? 0 : node.value.length;
    node.setSelectionRange(start, node.value.length);
  }, []);

  // Escape cancels wherever the focus sits, including on one of the side buttons - but an open
  // popover closes first (Section 2.6.5), and that one closes itself.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || useUiStore.getState().openPopover !== null) return;
      onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  /** Closing the editor takes any popover anchored to one of its buttons with it. */
  function dismiss(): void {
    setOpenPopover(null);
    onClose();
  }

  function opener(kind: PopoverKind): (anchor: HTMLElement) => void {
    return (element) => setOpenPopover({ kind, anchor: element });
  }

  function save(): void {
    const next = title.trim();
    if (next !== '' && next !== card.title) updateCard.mutate({ cardId: card.id, title: next });
    dismiss();
  }

  function archive(): void {
    archiveCard.mutate(card.id);
    show('Card archived', 'neutral', {
      label: 'Undo',
      onClick: () => unarchiveCard.mutate(card.id),
    });
    dismiss();
  }

  const actions: SideAction[] = [
    {
      label: 'Open card',
      icon: <CreditCard aria-hidden="true" />,
      onClick: () => {
        setOpenPopover(null);
        navigate(`/b/${boardId}/c/${card.id}`);
      },
    },
    { label: 'Edit labels', icon: <Tag aria-hidden="true" />, onClick: opener('labels') },
    { label: 'Change members', icon: <Users aria-hidden="true" />, onClick: opener('members') },
    { label: 'Change cover', icon: <Image aria-hidden="true" />, onClick: opener('cover') },
    { label: 'Move', icon: <ArrowRight aria-hidden="true" />, onClick: opener('moveCard') },
    { label: 'Copy', icon: <Copy aria-hidden="true" />, onClick: opener('copyCard') },
    { label: 'Edit dates', icon: <Clock aria-hidden="true" />, onClick: opener('dates') },
    { label: 'Archive', icon: <Archive aria-hidden="true" />, onClick: archive },
  ];

  // Only a popover anchored to one of this stack's buttons belongs to the quick editor: the
  // store holds one popover for the whole app (Section 5.13).
  const stack = stackRef.current;
  const own: OpenPopover | null =
    popover !== null &&
    popover.anchor instanceof HTMLElement &&
    stack !== null &&
    stack.contains(popover.anchor)
      ? popover
      : null;

  const flipped = box.right + GAP + SIDE_WIDTH > window.innerWidth;
  const stackStyle = flipped
    ? { top: box.top, right: window.innerWidth - box.left + GAP }
    : { top: box.top, left: box.right + GAP };

  return (
    <div className={styles.overlay}>
      <button type="button" className={styles.backdrop} aria-label="Cancel" onClick={dismiss} />

      <div className={styles.clone} style={{ top: box.top, left: box.left, width: box.width }}>
        <Textarea
          ref={textareaRef}
          className={styles.title}
          aria-label="Card title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onSubmit={save}
          onCancel={dismiss}
        />
        <div className={styles.saveRow}>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </div>
      </div>

      <div className={styles.stack} style={stackStyle} ref={stackRef}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={styles.action}
            onClick={(event) => action.onClick(event.currentTarget)}
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>

      {own === null || own.kind !== 'labels' ? null : (
        <LabelsPopover
          boardId={boardId}
          cardId={card.id}
          anchor={own.anchor}
          onClose={() => setOpenPopover(null)}
        />
      )}
      {own === null || own.kind !== 'dates' ? null : (
        <DatesPopover
          boardId={boardId}
          cardId={card.id}
          anchor={own.anchor}
          onClose={() => setOpenPopover(null)}
        />
      )}
      {own === null || own.kind !== 'members' ? null : (
        <MembersPopover
          boardId={boardId}
          cardId={card.id}
          anchor={own.anchor}
          onClose={() => setOpenPopover(null)}
        />
      )}
      {own === null || own.kind !== 'cover' ? null : (
        <CoverPopover
          boardId={boardId}
          cardId={card.id}
          anchor={own.anchor}
          onClose={() => setOpenPopover(null)}
        />
      )}
      {own === null || own.kind !== 'moveCard' ? null : (
        <MoveCardPopover
          boardId={boardId}
          cardId={card.id}
          anchor={own.anchor}
          onClose={() => setOpenPopover(null)}
        />
      )}
      {own === null || own.kind !== 'copyCard' ? null : (
        <CopyCardPopover
          boardId={boardId}
          cardId={card.id}
          anchor={own.anchor}
          onClose={() => setOpenPopover(null)}
        />
      )}
    </div>
  );
}
