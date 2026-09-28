import type { ReactElement } from 'react';
import { cx } from '@/components/ui';
import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  /** Items checked. */
  done: number;
  /** Items in the checklist; a checklist with none reads 0%. */
  total: number;
  /** Names what the bar measures, e.g. "Launch steps". */
  label: string;
}

/**
 * The checklist progress row of Section 2.6.3: the percentage in a 32px left cell, then an 8px
 * track that fills in `--progress` and turns `--success` at 100%.
 *
 * The width is an inline style because it is computed at runtime, which is the one exception
 * CLAUDE.md section 5 allows.
 */
export function ProgressBar({ done, total, label }: ProgressBarProps): ReactElement {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const complete = total > 0 && done === total;

  return (
    <div className={styles.row}>
      <span className={styles.percent}>{`${percent}%`}</span>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${total} complete`}
      >
        <div
          className={cx(styles.fill, complete && styles.complete)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
