import { useState, type ReactElement } from 'react';
import type { BoardSummary } from '@/api/types';
import { Button, ConfirmPopover } from '@/components/ui';
import { useDeleteBoard, useReopenBoard } from '@/hooks/useBoards';
import { boardBackgroundStyle } from '@/lib/boardGroups';
import styles from './ClosedBoardsModal.module.css';

/** Section 2.2, the delete confirmation body. Deleting a closed board has no undo. */
const DELETE_BODY =
  "All lists, cards and actions will be deleted, and you won't be able to re-open the board. There is no undo.";

export interface ClosedBoardRowProps {
  board: BoardSummary;
  /** `meta.board_gradients`, for the row's 40px background thumbnail. */
  gradients: Readonly<Record<string, string>>;
}

/**
 * One row of `ClosedBoardsModal`. It is its own component because reopen and delete are
 * per-board mutations, and a hook cannot be called inside a loop.
 */
export function ClosedBoardRow({ board, gradients }: ClosedBoardRowProps): ReactElement {
  const reopen = useReopenBoard(board.id);
  const remove = useDeleteBoard(board.id);
  const [confirmAnchor, setConfirmAnchor] = useState<HTMLElement | null>(null);

  return (
    <div className={styles.row}>
      <span
        className={styles.thumb}
        style={boardBackgroundStyle(board, gradients)}
        aria-hidden="true"
      />
      <span className={styles.name}>{board.name}</span>
      <span className={styles.actions}>
        <Button variant="primary" loading={reopen.isPending} onClick={() => reopen.mutate()}>
          Reopen
        </Button>
        <Button variant="danger" onClick={(event) => setConfirmAnchor(event.currentTarget)}>
          Delete
        </Button>
      </span>
      {confirmAnchor === null ? null : (
        <ConfirmPopover
          anchor={confirmAnchor}
          title="Delete board?"
          body={DELETE_BODY}
          confirmLabel="Delete"
          loading={remove.isPending}
          onConfirm={() => {
            remove.mutate();
            setConfirmAnchor(null);
          }}
          onClose={() => setConfirmAnchor(null)}
        />
      )}
    </div>
  );
}
