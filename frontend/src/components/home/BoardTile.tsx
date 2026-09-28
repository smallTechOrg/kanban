import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { BoardSummary } from '@/api/types';
import { cx } from '@/components/ui';
import { boardBackgroundStyle } from '@/lib/boardGroups';
import { StarButton } from './StarButton';
import styles from './BoardTile.module.css';

export interface BoardTileProps {
  board: BoardSummary;
  /** `meta.board_gradients`: the CSS behind a `gradient` background key (Section 2.9.3). */
  gradients: Readonly<Record<string, string>>;
}

/**
 * One 96px board tile (Section 2.2): the board background, the name over a hover scrim and
 * the star.
 *
 * The link covers the tile instead of wrapping it, because an anchor may not contain the
 * star's button; hovering anywhere over the tile still reveals the star and the scrim.
 */
export function BoardTile({ board, gradients }: BoardTileProps): ReactElement {
  return (
    <div className={styles.tile} style={boardBackgroundStyle(board, gradients)}>
      <span className={styles.overlay} aria-hidden="true" />
      <Link to={`/b/${board.id}`} className={styles.link}>
        <span className={styles.name}>{board.name}</span>
      </Link>
      <StarButton
        boardId={board.id}
        isStarred={board.is_starred}
        className={cx(styles.star, board.is_starred && styles.starVisible)}
      />
    </div>
  );
}
