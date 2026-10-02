import type { ReactElement, ReactNode } from 'react';
import styles from './Kbd.module.css';

export interface KbdProps {
  children: ReactNode;
}

/** A single keyboard key chip (Section 2.1.2), used in tooltips and the shortcut sheet. */
export function Kbd({ children }: KbdProps): ReactElement {
  return <kbd className={styles.kbd}>{children}</kbd>;
}
