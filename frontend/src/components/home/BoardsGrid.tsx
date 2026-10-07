import type { ReactElement, ReactNode } from 'react';
import styles from './BoardsGrid.module.css';

export interface BoardsGridProps {
  /** `BoardTile`s, the `CreateBoardTile` or the home page's loading skeletons. */
  children: ReactNode;
}

/** The tile grid of Section 2.2: `auto-fill`, a 194px minimum track and an 8px gap. */
export function BoardsGrid({ children }: BoardsGridProps): ReactElement {
  return <div className={styles.grid}>{children}</div>;
}
