import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star } from 'lucide-react';
import type { BoardSummary } from '@/api/types';
import { EmptyState, IconButton, Popover, Spinner, TextInput, cx } from '@/components/ui';
import { useBoards, useStarBoard } from '@/hooks/useBoards';
import { useMeta } from '@/hooks/useMeta';
import { boardBackgroundStyle } from '@/lib/boardGroups';
import styles from './BoardsPopover.module.css';

/**
 * Which list this panel shows: one of the two nav dropdowns (Section 2.1.1, item 4), or both at
 * once, which is what the `B` shortcut opens — "the `BoardsPopover` (Recent + Starred with a
 * filter input)" of Section 2.8.
 */
export type BoardsGroup = 'recent' | 'starred' | 'both';

/** The two lists `GET /api/boards` groups the caller's boards into (Section 4.3). */
type SingleGroup = Exclude<BoardsGroup, 'both'>;

export interface BoardsPopoverProps {
  anchor: HTMLElement | DOMRect;
  group: BoardsGroup;
  onClose: () => void;
}

const TITLE: Record<BoardsGroup, string> = {
  recent: 'Recently viewed',
  starred: 'Starred boards',
  both: 'Boards',
};

/** The 12px section labels the combined panel needs; a single-group panel has its title instead. */
const HEADING: Record<SingleGroup, string> = {
  recent: 'Recent',
  starred: 'Starred',
};

const EMPTY: Record<SingleGroup, string> = {
  recent: 'No recent boards',
  starred: 'Star boards to see them here',
};

const BOTH: readonly SingleGroup[] = ['recent', 'starred'];

interface BoardRowsProps {
  boards: readonly BoardSummary[];
  gradients: Readonly<Record<string, string>>;
  onOpen: (boardId: number) => void;
  onStar: (board: BoardSummary) => void;
}

/** The 32px rows of one group: thumbnail, name, and the star that toggles optimistically. */
function BoardRows({ boards, gradients, onOpen, onStar }: BoardRowsProps): ReactElement {
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
          <IconButton
            label={board.is_starred ? `Unstar ${board.name}` : `Star ${board.name}`}
            size="sm"
            onClick={() => onStar(board)}
          >
            <Star
              className={cx(styles.star, board.is_starred && styles.starred)}
              aria-hidden="true"
            />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Recent and Starred dropdowns: 32px rows with a 16px thumbnail of the board
 * background, the name, and a star that toggles optimistically (Sections 2.1.1 and 5.3).
 *
 * `group: 'both'` is the shape the `B` shortcut of Section 2.8 asks for — one panel titled
 * "Boards" holding both lists under their own 12px headings — because a keystroke aims at the
 * nav's "Boards" button rather than at one of the two dropdowns, and a reader who pressed it has
 * said nothing about which of the two lists they wanted. The filter input applies to whatever is
 * on screen, so it narrows one list or both.
 */
export function BoardsPopover({ anchor, group, onClose }: BoardsPopoverProps): ReactElement {
  const navigate = useNavigate();
  const { data: groups, isPending } = useBoards();
  const { data: meta } = useMeta();
  const starBoard = useStarBoard();
  const [filter, setFilter] = useState('');

  const needle = filter.trim().toLowerCase();
  const shown: readonly SingleGroup[] = group === 'both' ? BOTH : [group];

  const visible = (name: SingleGroup): BoardSummary[] => {
    const boards = (name === 'starred' ? groups?.starred : groups?.recent) ?? [];
    return needle === ''
      ? boards
      : boards.filter((board) => board.name.toLowerCase().includes(needle));
  };

  const open = (boardId: number): void => {
    onClose();
    navigate(`/b/${boardId}`);
  };

  return (
    <Popover anchor={anchor} title={TITLE[group]} onClose={onClose}>
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
      ) : (
        shown.map((name) => {
          const boards = visible(name);
          return (
            <section key={name} className={styles.group}>
              {group === 'both' ? <h3 className={styles.groupLabel}>{HEADING[name]}</h3> : null}
              {boards.length === 0 ? (
                <EmptyState message={EMPTY[name]} />
              ) : (
                <BoardRows
                  boards={boards}
                  gradients={meta?.board_gradients ?? {}}
                  onOpen={open}
                  onStar={(board) =>
                    starBoard.mutate({ boardId: board.id, isStarred: !board.is_starred })
                  }
                />
              )}
            </section>
          );
        })
      )}
    </Popover>
  );
}
