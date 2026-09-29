import type { ReactElement } from 'react';
import { List } from 'lucide-react';
import { ActivityFeed } from './ActivityFeed';
import styles from './ActivitySection.module.css';

export interface ActivitySectionProps {
  boardId: number;
  cardId: number;
}

/** The activity section of Section 2.6.3: the heading and the card's feed under it. */
export function ActivitySection({ boardId, cardId }: ActivitySectionProps): ReactElement {
  return (
    <section className={styles.section} aria-labelledby="card-activity-heading">
      <div className={styles.header}>
        <List className={styles.icon} aria-hidden="true" size={16} />
        <h3 className={styles.heading} id="card-activity-heading">
          Activity
        </h3>
      </div>

      <div className={styles.body}>
        <ActivityFeed boardId={boardId} cardId={cardId} />
      </div>
    </section>
  );
}
