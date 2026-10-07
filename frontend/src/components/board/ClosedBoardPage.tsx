import { useState, type ReactElement } from 'react';
import { Archive } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { BoardSummary } from '@/api/types';
import { Button, ConfirmPopover } from '@/components/ui';
import { useDeleteBoard, useReopenBoard } from '@/hooks/useBoards';
import styles from './ClosedBoardPage.module.css';

/** Section 2.3.5, the body copy of the card. */
const BODY =
  'This space is closed. Reopen it to see and edit its lists and cards, or delete it permanently.';

/** The same warning `ClosedBoardsModal` shows, because it is the same irreversible write. */
const DELETE_BODY =
  "All lists, cards and actions will be deleted, and you won't be able to re-open the space. There is no undo.";

export interface ClosedBoardPageProps {
  board: BoardSummary;
}

/**
 * The closed-board screen of Section 2.3.5, rendered by `BoardPage` in place of the header
 * and canvas while `board.is_closed` is true. `GET /api/boards/{board_id}` still returns the
 * payload for a closed board, so a direct link or the Back button lands here rather than on
 * an editable board.
 *
 * Reopening needs no navigation: the mutation writes the fresh row into `['board', id]` and
 * `BoardPage` re-renders the real board in place.
 */
export function ClosedBoardPage({ board }: ClosedBoardPageProps): ReactElement {
  const navigate = useNavigate();
  const reopen = useReopenBoard(board.id);
  const remove = useDeleteBoard(board.id);
  const [confirmAnchor, setConfirmAnchor] = useState<HTMLElement | null>(null);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <Archive className={styles.icon} size={32} aria-hidden="true" />
        <h2 className={styles.heading}>{board.name} is closed</h2>
        <p className={styles.body}>{BODY}</p>

        <Button
          variant="primary"
          fullWidth
          loading={reopen.isPending}
          onClick={() => reopen.mutate()}
        >
          Reopen space
        </Button>
        <Button
          variant="danger"
          fullWidth
          onClick={(event) => setConfirmAnchor(event.currentTarget)}
        >
          Delete space
        </Button>

        <Button variant="link" onClick={() => navigate('/')}>
          Back to spaces
        </Button>
      </div>

      {confirmAnchor === null ? null : (
        <ConfirmPopover
          anchor={confirmAnchor}
          title="Delete space?"
          body={DELETE_BODY}
          confirmLabel="Delete"
          loading={remove.isPending}
          onConfirm={() => {
            remove.mutate(undefined, { onSuccess: () => navigate('/') });
            setConfirmAnchor(null);
          }}
          onClose={() => setConfirmAnchor(null)}
        />
      )}
    </div>
  );
}
