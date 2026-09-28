import type { ReactElement, ReactNode } from 'react';
import { cx } from './classNames';
import { Tooltip } from './Tooltip';
import styles from './MenuRow.module.css';

export interface MenuRowProps {
  onClick: () => void;
  /** A 16px lucide icon, rendered left of the label. */
  icon?: ReactNode;
  /** Muted second line, e.g. the account email. */
  helper?: ReactNode;
  /** A scope guard: the row is visible but inert (Sections 2.3.1 and 2.4.3). */
  disabled?: boolean;
  /** Explains a disabled row, e.g. "List watching is not available yet". */
  tooltip?: ReactNode;
  children: ReactNode;
}

/**
 * One full-width 32px row of a popover menu — the shape shared by "Switch to", the Create
 * menu, the user menu (Section 2.1.1) and every group of `ListMenuPopover` (Section 2.4.3),
 * so none of them restyles it.
 */
export function MenuRow({
  onClick,
  icon,
  helper,
  disabled = false,
  tooltip,
  children,
}: MenuRowProps): ReactElement {
  const row = (
    <button
      type="button"
      className={cx(styles.row, disabled && styles.disabled)}
      disabled={disabled}
      onClick={onClick}
    >
      {icon === undefined ? null : <span className={styles.icon}>{icon}</span>}
      <span className={styles.text}>
        <span className={styles.label}>{children}</span>
        {helper === undefined ? null : <span className={styles.helper}>{helper}</span>}
      </span>
    </button>
  );

  if (tooltip === undefined) return row;
  return (
    <Tooltip content={tooltip} className={styles.wrap}>
      {row}
    </Tooltip>
  );
}
