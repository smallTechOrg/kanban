import { useState, type ReactElement } from 'react';
import { ChevronDown, ChevronRight, Home, LayoutDashboard, LayoutTemplate } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { Tooltip, cx } from '@/components/ui';
import { initialsFromName } from '@/lib/boardGroups';
import styles from './HomeSidebar.module.css';

export interface HomeSidebarProps {
  /** The single workspace of v1; its name is owned by `HomePage` (Section 2.2). */
  workspaceName: string;
}

/** `NavLink`'s class callback, so the active row keeps its own colours (Section 2.2). */
function rowClass({ isActive }: { isActive: boolean }): string {
  return cx(styles.row, isActive && styles.active);
}

/**
 * The 240px sticky home sidebar of Section 2.2. Templates and Home are affordances that
 * arrive after v1, so they render disabled rather than as dead links; the workspace group
 * expands to the three workspace routes of Section 5.2.
 */
export function HomeSidebar({ workspaceName }: HomeSidebarProps): ReactElement {
  const [expanded, setExpanded] = useState(true);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <nav className={styles.sidebar} aria-label="Workspace">
      <ul className={styles.list}>
        <li>
          <NavLink to="/" end className={rowClass}>
            <LayoutDashboard className={styles.icon} aria-hidden="true" />
            Boards
          </NavLink>
        </li>
        <li>
          <Tooltip content="Coming later">
            <button type="button" className={styles.row} disabled>
              <LayoutTemplate className={styles.icon} aria-hidden="true" />
              Templates
            </button>
          </Tooltip>
        </li>
        <li>
          <button type="button" className={styles.row} disabled>
            <Home className={styles.icon} aria-hidden="true" />
            Home
          </button>
        </li>
      </ul>

      <p className={styles.heading}>Workspaces</p>
      <button
        type="button"
        className={styles.row}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={styles.badge} aria-hidden="true">
          {initialsFromName(workspaceName, 1)}
        </span>
        <span className={styles.workspace}>{workspaceName}</span>
        <Chevron className={styles.icon} aria-hidden="true" />
      </button>
      {expanded ? (
        <ul className={styles.list}>
          <li>
            <NavLink to="/" end className={rowClass}>
              Boards
            </NavLink>
          </li>
          <li>
            <NavLink to="/w/members" className={rowClass}>
              Members
            </NavLink>
          </li>
          <li>
            <NavLink to="/w/settings" className={rowClass}>
              Settings
            </NavLink>
          </li>
        </ul>
      ) : null}
    </nav>
  );
}
