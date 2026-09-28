import type { ReactElement, ReactNode } from 'react';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  /** The 14px muted blurb every empty state in Section 2.10 shows. */
  message: ReactNode;
  title?: string;
  /** A lucide icon, rendered above the text. */
  icon?: ReactNode;
  /** A call to action, e.g. a `Button`. */
  action?: ReactNode;
}

/** The shared empty state of Section 2.10 ("No archived cards", "No comments yet", ...). */
export function EmptyState({ message, title, icon, action }: EmptyStateProps): ReactElement {
  return (
    <div className={styles.empty}>
      {icon === undefined ? null : <span className={styles.icon}>{icon}</span>}
      {title === undefined ? null : <p className={styles.title}>{title}</p>}
      <p className={styles.message}>{message}</p>
      {action}
    </div>
  );
}
