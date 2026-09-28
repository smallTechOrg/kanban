import type { ReactElement } from 'react';
import { cx } from '@/components/ui';
import { useBoardFilter } from '@/hooks/useBoardFilter';
import { useListCards } from '@/hooks/useBoardData';
import { CardsDroppable } from './BoardDndContext';
import { CardTile } from './CardTile';
import styles from './CardList.module.css';

export interface CardListProps {
  boardId: number;
  listId: number;
}

/**
 * The scrollable card region of a column (Section 2.4.1): the only vertical scroll container
 * on the board, 8px scrollbar, and a 6px floor so an empty list still offers a drop target
 * that can grow a placeholder (Section 2.4.5).
 *
 * It is the list's `type="CARD"` droppable, and it reads the rows rather than the ids because
 * a tile keys on `client_id ?? id`: an optimistic card is created with a temporary id, and
 * keying on the id the server swaps in would remount the tile mid-flight (Section 5.4.2).
 *
 * `cardList` is the global class Section 5.6 puts the card-region scrollbar rules under.
 *
 * A card the filter does not match is still rendered, as a `Draggable` wearing `display: none`
 * (Section 2.3.3): the index a drop reports is an index over every active card of the list, so
 * dropping onto a filtered board must not renumber the ones that are hidden.
 */
export function CardList({ boardId, listId }: CardListProps): ReactElement {
  const cards = useListCards(boardId, listId).data ?? [];
  const { active, matches } = useBoardFilter(boardId);

  return (
    <CardsDroppable listId={listId} className={cx('cardList', styles.region)}>
      {cards.map((card, index) => (
        <CardTile
          key={card.client_id ?? card.id}
          boardId={boardId}
          cardId={card.id}
          index={index}
          hidden={active && !matches(card)}
        />
      ))}
    </CardsDroppable>
  );
}
