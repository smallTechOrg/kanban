import type { ReactElement } from 'react';
import { AppWindow } from 'lucide-react';
import { InlineEditable } from '@/components/ui';
import { useUpdateCardFields } from '@/hooks/useCardMutations';
import styles from './CardModalHeader.module.css';

export interface CardModalHeaderProps {
  boardId: number;
  cardId: number;
  /** The card title, from the detail payload or the board cache while it loads (2.10). */
  title: string;
  /** `CardDetail.list_name`; empty until the payload arrives. */
  listName: string;
}

/**
 * The card modal's header (Section 2.6.2): the 16px window icon, the title as a click-to-edit
 * textarea and the "in list <name>" sub-line.
 *
 * The list name is text rather than a control: a card is moved by dragging it, and there is no
 * Move panel for it to open.
 *
 * The title's accessible name is "Rename card <title>", not "Card name": `InlineEditable`
 * renders a `<button>` whose visible text is the title, and an `aria-label` on it wins the
 * enclosing heading's name computation — so a bare "Card name" would hide the card from
 * assistive tech and fail WCAG 2.5.3 (Label in Name). This is the same form the board and list
 * titles already use (CLAUDE.md section 8).
 */
export function CardModalHeader({
  boardId,
  cardId,
  title,
  listName,
}: CardModalHeaderProps): ReactElement {
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
            onSave={(next) => update.mutate({ title: next })}
          />
        </h2>

        <p className={styles.subline}>
          {listName === '' ? null : (
            <>
              {'in list '}
              <span className={styles.listName}>{listName}</span>
            </>
          )}
        </p>
      </div>
    </header>
  );
}
