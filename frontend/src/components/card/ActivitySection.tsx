import type { ReactElement } from 'react';
import { List } from 'lucide-react';
import { Button } from '@/components/ui';
import { useUiStore } from '@/store/uiStore';
import { ActivityFeed } from './ActivityFeed';
import { CommentBox } from './CommentBox';
import styles from './ActivitySection.module.css';

export interface ActivitySectionProps {
  boardId: number;
  cardId: number;
}

/**
 * The activity section of Section 2.6.3: the heading, the "Show details" / "Hide details"
 * toggle, the comment composer and the feed.
 *
 * The toggle is `uiStore.activityDetails`, persisted as `localStorage.kb_activityDetails` and
 * defaulting to hidden (Section 5.13). It is sent to the server explicitly as `details=0` or
 * `details=1` and never left to the API's own default of 1 (Section 4.5), which is why it lives
 * in the store rather than in this component's state: a reload must ask for the same thing the
 * user last chose.
 */
export function ActivitySection({ boardId, cardId }: ActivitySectionProps): ReactElement {
  const details = useUiStore((state) => state.activityDetails);
  const setDetails = useUiStore((state) => state.setActivityDetails);

  return (
    <section className={styles.section} aria-labelledby="card-activity-heading">
      <div className={styles.header}>
        <List className={styles.icon} aria-hidden="true" size={16} />
        <h3 className={styles.heading} id="card-activity-heading">
          Activity
        </h3>
        <Button onClick={() => setDetails(!details)}>
          {details ? 'Hide details' : 'Show details'}
        </Button>
      </div>

      <div className={styles.body}>
        <CommentBox boardId={boardId} cardId={cardId} />
        <ActivityFeed boardId={boardId} cardId={cardId} />
      </div>
    </section>
  );
}
