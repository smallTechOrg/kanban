import type { ReactElement } from 'react';
import { Button, EmptyState, Spinner } from '@/components/ui';
import { useCardActivity } from '@/hooks/useBoardActivity';
import type { Activity } from '@/api/types';
import { activitySentence } from '@/lib/activity';
import { formatDateTime, relativeTime } from '@/lib/dates';
import styles from './ActivityFeed.module.css';

/** A failed read is not an empty feed (the same rule `BoardActivityFeed` follows). */
const LOAD_ERROR = "Couldn't load activity.";

export interface ActivityFeedProps {
  boardId: number;
  cardId: number;
}

interface ActivityRowProps {
  activity: Activity;
  /** The open card, whose `card_title` reads "this card" in this feed (Section 2.6.3). */
  openCardId: number;
}

function ActivityRow({ activity, openCardId }: ActivityRowProps): ReactElement | null {
  const sentence = activitySentence(activity, { openCardId });
  if (sentence === null) return null;

  return (
    <li className={styles.row}>
      <p className={styles.sentence}>{sentence}</p>
      <time
        className={styles.time}
        dateTime={activity.created_at}
        title={formatDateTime(activity.created_at)}
      >
        {relativeTime(activity.created_at)}
      </time>
    </li>
  );
}

/**
 * The card feed of Section 2.6.3: this card's activity rows newest first, paged with
 * `before=<activities.id>` behind a "Load more" button.
 *
 * It is the board feed narrowed by `card_id` — one endpoint, one response shape, one key space
 * (`hooks/useBoardActivity.ts`) — so the drawer's feed and this one can never disagree about what
 * happened.
 *
 * Not one sentence is written here. `lib/activity.ts` renders every one of them from the
 * `type` + `data` the server stored, which is what makes the feed survive a rename, and it is
 * told which card is open so `card_title` reads "this card". A type with no sentence (a reorder
 * that only travels over SSE) renders nothing at all rather than a broken line.
 */
export function ActivityFeed({ boardId, cardId }: ActivityFeedProps): ReactElement {
  const feed = useCardActivity(boardId, cardId);

  if (feed.isPending) {
    return (
      <div className={styles.loading}>
        <Spinner size={24} label="Loading activity" />
      </div>
    );
  }

  if (feed.isError) return <EmptyState message={LOAD_ERROR} />;

  const items = (feed.data?.pages ?? []).flatMap((page) => page.items);

  if (items.length === 0) return <EmptyState message="No activity yet" />;

  return (
    <div>
      <ul className={styles.feed}>
        {items.map((activity) => (
          <ActivityRow key={activity.id} activity={activity} openCardId={cardId} />
        ))}
      </ul>

      {feed.hasNextPage ? (
        <Button
          fullWidth
          loading={feed.isFetchingNextPage}
          onClick={() => void feed.fetchNextPage()}
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}
