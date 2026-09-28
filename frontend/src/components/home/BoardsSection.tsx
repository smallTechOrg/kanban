import type { ReactElement, ReactNode } from 'react';
import { cx } from '@/components/ui';
import styles from './BoardsSection.module.css';

export interface BoardsSectionProps {
  title: string;
  /** A 16px lucide icon beside the heading; the workspaces section has none. */
  icon?: ReactNode;
  /**
   * `eyebrow` is the 12px 700 uppercase "YOUR WORKSPACES" heading; `heading` is the 16px
   * row used by Starred boards and Recently viewed (Section 2.2).
   */
  variant?: 'heading' | 'eyebrow';
  /** Rendered between the heading and the grid — the workspace header row of Section 2.2. */
  header?: ReactNode;
  /** The `BoardsGrid`, plus whatever sits under it (the empty-state blurb, the closed link). */
  children: ReactNode;
}

/** One home-page section: a heading row, an optional sub-header and the grid (Section 2.2). */
export function BoardsSection({
  title,
  icon,
  variant = 'heading',
  header,
  children,
}: BoardsSectionProps): ReactElement {
  return (
    <section className={styles.section}>
      <h3 className={cx(styles.title, variant === 'eyebrow' && styles.eyebrow)}>
        {icon === undefined ? null : <span className={styles.icon}>{icon}</span>}
        {title}
      </h3>
      {header}
      {children}
    </section>
  );
}
