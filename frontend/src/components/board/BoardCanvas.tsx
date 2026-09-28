import type { ReactElement } from 'react';
import { cx } from '@/components/ui';
import { useBoardMeta, useListOrder } from '@/hooks/useBoardData';
import { useUiStore } from '@/store/uiStore';
import { AddListComposer } from './AddListComposer';
import { BoardDndContext, ListsDroppable } from './BoardDndContext';
import { ListColumn } from './ListColumn';
import styles from './BoardCanvas.module.css';

export interface BoardCanvasProps {
  boardId: number;
}

/**
 * The horizontally scrolling canvas of Section 2.3.2: the columns in `position` order inside
 * the board's one horizontal `LIST` droppable, then `AddListComposer`. It fills the viewport
 * below the 44px nav and the 48px board header and carries the 12px scrollbar of Section 5.6
 * (the global `canvas` class).
 *
 * Observers cannot write to the board (Section 4.1), so the composer is not rendered for them
 * rather than failing on the click; their columns are `isDragDisabled` inside `ListDraggable`.
 *
 * While `BoardMenuDrawer` is open the canvas pads itself by the drawer's width above 1024px, so
 * the last column is not left underneath it (Section 2.3.4).
 */
export function BoardCanvas({ boardId }: BoardCanvasProps): ReactElement {
  const listOrder = useListOrder(boardId).data ?? [];
  const role = useBoardMeta(boardId).data?.my_role;
  const canEdit = role !== undefined && role !== 'observer';
  const boardMenuOpen = useUiStore((state) => state.boardMenuOpen);

  return (
    <BoardDndContext boardId={boardId}>
      <div className={cx('canvas', styles.canvas, boardMenuOpen && styles.withDrawer)}>
        <ListsDroppable className={styles.lists}>
          {listOrder.map((listId, index) => (
            <ListColumn key={listId} boardId={boardId} listId={listId} index={index} />
          ))}
        </ListsDroppable>
        {canEdit ? (
          <AddListComposer boardId={boardId} isEmptyBoard={listOrder.length === 0} />
        ) : null}
      </div>
    </BoardDndContext>
  );
}
