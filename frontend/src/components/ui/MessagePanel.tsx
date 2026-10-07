import type { ReactElement, ReactNode } from 'react';
import styles from './MessagePanel.module.css';

export interface MessagePanelProps {
  title: string;
  children?: ReactNode;
}

/** A centred card with a heading and a short body. The frame every stub page borrows. */
export function MessagePanel({ title, children }: MessagePanelProps): ReactElement {
  return (
    <main className={styles.panel}>
      <h1 className={styles.title}>{title}</h1>
      {children === undefined ? null : <div className={styles.body}>{children}</div>}
    </main>
  );
}
