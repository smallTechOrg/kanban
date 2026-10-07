import type { ReactElement } from 'react';
import { EmptyState, Modal, Spinner } from '@/components/ui';
import { useClosedBoards } from '@/hooks/useBoards';
import { useMeta } from '@/hooks/useMeta';
import { ClosedBoardRow } from './ClosedBoardRow';
import styles from './ClosedBoardsModal.module.css';

/** Section 2.2: the closed-boards list is a 600px modal, wider than the 304px popover. */
const WIDTH = 600;

export interface ClosedBoardsModalProps {
  onClose: () => void;
}

/**
 * "Closed boards" (Section 2.2): the rows of `GET /api/boards?closed=1`, each offering
 * Reopen and a confirmed Delete to a board admin.
 */
export function ClosedBoardsModal({ onClose }: ClosedBoardsModalProps): ReactElement {
  const { data, isPending } = useClosedBoards();
  const { data: meta } = useMeta();
  const boards = data ?? [];
  const gradients = meta?.board_gradients ?? {};

  return (
    <Modal title="Closed spaces" width={WIDTH} onClose={onClose}>
      {isPending ? (
        <div className={styles.loading}>
          <Spinner size={24} label="Loading closed spaces" />
        </div>
      ) : boards.length === 0 ? (
        <EmptyState message="No closed spaces" />
      ) : (
        <ul className={styles.rows}>
          {boards.map((board) => (
            <li key={board.id}>
              <ClosedBoardRow board={board} gradients={gradients} />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
