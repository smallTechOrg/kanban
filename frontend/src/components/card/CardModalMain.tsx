import type { ReactElement } from 'react';
import type { CardDetail } from '@/api/types';
import { ActivitySection } from './ActivitySection';
import { DescriptionEditor } from './DescriptionEditor';
import { ItemsSection } from './ItemsSection';
import { QuickBadgesRow } from './QuickBadgesRow';
import styles from './CardModalMain.module.css';

export interface CardModalMainProps {
  boardId: number;
  card: CardDetail;
  /** Whether "Hide checked items" is on; the modal owns it (`ItemsSection`). */
  hideChecked: boolean;
  onToggleHideChecked: () => void;
}

/**
 * The 552px main column of Section 2.6.3, in the documented order: the quick badges, the
 * description, the card's items, then the activity.
 *
 * The items sit in the card's one `ITEM` droppable and are reordered by dragging their rows;
 * there is no second container to move between, because a card's items hang off the card itself.
 * The `DragDropContext` that droppable belongs to is in `CardDetailModal`.
 *
 * `ItemsSection` renders whether or not the card has any items: with no named checklist to
 * create first, "Add an item" has to be reachable from an empty card (Section 2.10).
 */
export function CardModalMain({
  boardId,
  card,
  hideChecked,
  onToggleHideChecked,
}: CardModalMainProps): ReactElement {
  return (
    <div className={styles.main}>
      <QuickBadgesRow boardId={boardId} card={card} />
      <DescriptionEditor boardId={boardId} card={card} />
      <ItemsSection
        boardId={boardId}
        cardId={card.id}
        items={card.items}
        hideChecked={hideChecked}
        onToggleHideChecked={onToggleHideChecked}
      />
      <ActivitySection boardId={boardId} cardId={card.id} />
    </div>
  );
}
