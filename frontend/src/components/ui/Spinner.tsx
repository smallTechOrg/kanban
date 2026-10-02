import type { ReactElement } from 'react';
import { cx } from './classNames';
import styles from './Spinner.module.css';

export interface SpinnerProps {
  /** Diameter in pixels. 16 matches --icon-size, the size used inside buttons. */
  size?: number;
  /**
   * Announced to screen readers. Without it the spinner is decorative, which is what a
   * `loading` Button wants: the button already carries `aria-busy` and its own label.
   */
  label?: string;
  /** Renders the track in white for use on a primary/danger fill. */
  onDark?: boolean;
}

/**
 * The indeterminate loading indicator (Section 2.10). Skeletons are per-surface and live
 * with the component that owns them; this is the generic spinner for buttons and panels.
 */
export function Spinner({ size = 16, label, onDark = false }: SpinnerProps): ReactElement {
  const border = Math.max(2, Math.round(size / 8));
  return (
    <span
      className={cx(styles.spinner, onDark && styles.onDark)}
      style={{ width: size, height: size, borderWidth: border }}
      role={label === undefined ? undefined : 'status'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    />
  );
}
