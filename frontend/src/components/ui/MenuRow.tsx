import type { ReactElement, ReactNode } from 'react';
import styles from './MenuRow.module.css';

export interface MenuRowProps {
  onClick: () => void;
  /** A 16px lucide icon, rendered left of the label. */
  icon?: ReactNode;
  /** Muted second line, e.g. what the Create menu's two rows make. */
  helper?: ReactNode;
  children: ReactNode;
}

/**
 * One full-width 32px row of a popover menu — the shape shared by "Switch to", the Create
 * menu (Section 2.1.1) and every group of `ListMenuPopover` (Section 2.4.3), so none of them
 * restyles it.
 */
export function MenuRow({ onClick, icon, helper, children }: MenuRowProps): ReactElement {
  return (
    <button type="button" className={styles.row} onClick={onClick}>
      {icon === undefined ? null : <span className={styles.icon}>{icon}</span>}
      <span className={styles.text}>
        <span className={styles.label}>{children}</span>
        {helper === undefined ? null : <span className={styles.helper}>{helper}</span>}
      </span>
    </button>
  );
}
