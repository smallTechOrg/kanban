import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BoardSummary } from '@/api/types';
import { EmptyState, Popover, Spinner, TextInput } from '@/components/ui';
import { useBoards } from '@/hooks/useBoards';
import { useMeta } from '@/hooks/useMeta';
import { boardBackgroundStyle } from '@/lib/boardGroups';
import styles from './BoardsPopover.module.css';

export interface BoardsPopoverProps {
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
}

const EMPTY_MESSAGE = 'No boards yet';

interface BoardRowsProps {
  boards: readonly BoardSummary[];
  gradients: Readonly<Record<string, string>>;
  onOpen: (boardId: number) => void;
}

/** The 32px rows: a 16px thumbnail of the board background and the name. */
function BoardRows({ boards, gradients, onOpen }: BoardRowsProps): ReactElement {
  return (
    <ul className={styles.list}>
      {boards.map((board) => (
        <li key={board.id} className={styles.row}>
          <button type="button" className={styles.open} onClick={() => onOpen(board.id)}>
            <span
              className={styles.thumb}
              style={boardBackgroundStyle(board, gradients)}
              aria-hidden="true"
            />
            <span className={styles.name}>{board.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The nav's Boards dropdown, and what the `B` shortcut of Section 2.8 opens: every board in one
 * list, narrowed by the filter input (Sections 2.1.1 and 5.3).
 *
 * There is no Recent group and no Starred group to choose between any more, so the panel takes
 * no `group` prop: one person's boards are one list, here as on the home page.
 */
export function BoardsPopover({ anchor, onClose }: BoardsPopoverProps): ReactElement {
  const navigate = useNavigate();
  const { data: groups, isPending } = useBoards();
  const { data: meta } = useMeta();
  const [filter, setFilter] = useState('');

  const needle = filter.trim().toLowerCase();
  const all = groups?.all ?? [];
  const boards =
    needle === '' ? all : all.filter((board) => board.name.toLowerCase().includes(needle));

  const open = (boardId: number): void => {
    onClose();
    navigate(`/b/${boardId}`);
  };

  return (
    <Popover anchor={anchor} title="Boards" onClose={onClose}>
      <TextInput
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter boards"
        aria-label="Filter boards"
      />
      {isPending ? (
        <div className={styles.loading}>
          <Spinner size={24} label="Loading boards" />
        </div>
      ) : boards.length === 0 ? (
        <EmptyState message={EMPTY_MESSAGE} />
      ) : (
        <BoardRows boards={boards} gradients={meta?.board_gradients ?? {}} onOpen={open} />
      )}
    </Popover>
  );
}
