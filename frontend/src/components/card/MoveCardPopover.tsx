import { useState, type ReactElement } from 'react';
import { Button, Popover, Spinner } from '@/components/ui';
import { useCard, useListCards } from '@/hooks/useBoardData';
import { useMoveCardTo } from '@/hooks/useCardMutations';
import { DestinationSelects, type Destination } from './DestinationSelects';
import styles from './MoveCardPopover.module.css';

export interface MoveCardPopoverProps {
  boardId: number;
  cardId: number;
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
}

/**
 * "Move card" (Section 2.6.5), opened from the sidebar's Move row, the quick editor's Move
 * button and the list-name link in the modal header.
 *
 * It sends the index form only — `{to_list_id, index}` plus `to_board_id` when the board
 * changes — and never `prev_id` / `next_id`, which belong to `onDragEnd` alone (Section 4.9).
 * The card and its current slot come from the board cache, so the panel is complete on the
 * first frame; only picking *another* board costs a request (`useDestinationLists`).
 */
export function MoveCardPopover({
  boardId,
  cardId,
  anchor,
  onClose,
}: MoveCardPopoverProps): ReactElement {
  const [destination, setDestination] = useState<Destination | null>(null);
  const card = useCard(boardId, cardId).data;
  const siblings = useListCards(boardId, card?.list_id ?? 0).data ?? [];
  const moveCard = useMoveCardTo(boardId, cardId);

  function move(): void {
    if (destination === null) return;
    moveCard.mutate({
      toListId: destination.listId,
      index: destination.index,
      toBoardId: destination.boardId,
    });
    onClose();
  }

  const currentIndex = siblings.findIndex((row) => row.id === cardId);

  return (
    <Popover anchor={anchor} title="Move card" onClose={onClose}>
      {card === undefined ? (
        <Spinner />
      ) : (
        <div className={styles.body}>
          <h4 className={styles.heading}>Select destination</h4>
          <DestinationSelects
            boardId={boardId}
            listId={card.list_id}
            currentIndex={currentIndex === -1 ? null : currentIndex}
            onChange={setDestination}
          />
          <Button variant="primary" disabled={destination === null} onClick={move}>
            Move
          </Button>
        </div>
      )}
    </Popover>
  );
}
