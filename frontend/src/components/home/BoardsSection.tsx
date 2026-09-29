import type { ReactElement, ReactNode } from 'react';
import { cx } from '@/components/ui';
import styles from './BoardsSection.module.css';

export interface BoardsSectionProps {
  title: string;
  /** A 16px lucide icon beside the heading; the all-boards section has none. */
  icon?: ReactNode;
  /**
   * `eyebrow` is the 12px 700 uppercase "YOUR BOARDS" heading; `heading` is the 16px
   * row used by Starred boards and Recently viewed (Section 2.2).
   */
  variant?: 'heading' | 'eyebrow';
  /** The `BoardsGrid`, plus whatever sits under it (the empty-state blurb, the closed link). */
  children: ReactNode;
}

/** One home-page section: a heading row and the grid under it (Section 2.2). */
export function BoardsSection({
  title,
  icon,
  variant = 'heading',
  children,
}: BoardsSectionProps): ReactElement {
  return (
    <section className={styles.section}>
      <h3 className={cx(styles.title, variant === 'eyebrow' && styles.eyebrow)}>
        {icon === undefined ? null : <span className={styles.icon}>{icon}</span>}
        {title}
      </h3>
      {children}
    </section>
  );
}
