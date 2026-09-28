import { useState, type ReactElement } from 'react';
import { AppWindow, Eye } from 'lucide-react';
import { InlineEditable } from '@/components/ui';
import { useUpdateCardFields } from '@/hooks/useCardMutations';
import { MoveCardPopover } from './MoveCardPopover';
import styles from './CardModalHeader.module.css';

export interface CardModalHeaderProps {
  boardId: number;
  cardId: number;
  /** The card title, from the detail payload or the board cache while it loads (2.10). */
  title: string;
  /** `CardDetail.list_name`; empty until the payload arrives. */
  listName: string;
  /** `CardDetail.is_watching`: the eye is a state indicator, not a control (Section 2.6.2). */
  isWatching?: boolean;
  readOnly?: boolean;
}

/**
 * The card modal's header (Section 2.6.2): the 16px window icon, the title as a click-to-edit
 * textarea, the "in list <name>" link and the watched eye.
 *
 * The title's accessible name is "Rename card <title>", not "Card name": `InlineEditable`
 * renders a `<button>` whose visible text is the title, and an `aria-label` on it wins the
 * enclosing heading's name computation — so a bare "Card name" would hide the card from
 * assistive tech and fail WCAG 2.5.3 (Label in Name). This is the same form the board and list
 * titles already use (CLAUDE.md section 8).
 *
 * The eye is not a button. Section 2.6.2 says "a 12px eye icon follows when watched", and the
 * two controls that *change* watching are the sidebar's Watch row and the Notifications group of
 * `QuickBadgesRow` (Sections 2.6.3 and 2.6.4); a third toggle here would be a second copy of
 * that rule, so this is the read-only mirror of it and carries its state as text for a reader
 * who cannot see the icon.
 */
export function CardModalHeader({
  boardId,
  cardId,
  title,
  listName,
  isWatching = false,
  readOnly = false,
}: CardModalHeaderProps): ReactElement {
  const [moveAnchor, setMoveAnchor] = useState<HTMLElement | null>(null);
  const update = useUpdateCardFields(boardId, cardId);

  return (
    <header className={styles.header}>
      <AppWindow className={styles.icon} aria-hidden="true" size={16} />

      <div className={styles.text}>
        <h2 className={styles.title}>
          <InlineEditable
            value={title}
            label={`Rename card ${title}`}
            className={styles.titleInput}
            disabled={readOnly}
            onSave={(next) => update.mutate({ title: next })}
          />
        </h2>

        <p className={styles.subline}>
          {listName === '' ? null : (
            <>
              {'in list '}
              <button
                type="button"
                className={styles.listName}
                disabled={readOnly}
                onClick={(event) => setMoveAnchor(event.currentTarget)}
              >
                {listName}
              </button>
            </>
          )}
          {isWatching ? (
            <span className={styles.watch}>
              <Eye aria-hidden="true" size={12} />
              <span className={styles.state}>Watching this card</span>
            </span>
          ) : null}
        </p>
      </div>

      {moveAnchor === null ? null : (
        <MoveCardPopover
          anchor={moveAnchor}
          boardId={boardId}
          cardId={cardId}
          onClose={() => setMoveAnchor(null)}
        />
      )}
    </header>
  );
}
