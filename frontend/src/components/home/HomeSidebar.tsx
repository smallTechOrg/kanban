import type { ReactElement } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { cx } from '@/components/ui';
import styles from './HomeSidebar.module.css';

/** `NavLink`'s class callback, so the active row keeps its own colours (Section 2.2). */
function rowClass({ isActive }: { isActive: boolean }): string {
  return cx(styles.row, isActive && styles.active);
}

/** The 240px sticky home sidebar of Section 2.2, holding the one destination there is. */
export function HomeSidebar(): ReactElement {
  return (
    <nav className={styles.sidebar} aria-label="Boards">
      <ul className={styles.list}>
        <li>
          <NavLink to="/" end className={rowClass}>
            <LayoutDashboard className={styles.icon} aria-hidden="true" />
            Boards
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}
