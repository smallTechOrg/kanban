import { useEffect, useRef, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { Activity } from '@/api/types';
import { Avatar, Button, EmptyState, Spinner } from '@/components/ui';
import { useBoardActivity } from '@/hooks/useBoardActivity';
import { activitySentence } from '@/lib/activity';
import { formatDateTime, relativeTime } from '@/lib/dates';
import styles from './BoardActivityFeed.module.css';

/** A failed read is not an empty feed (the same rule `ArchivedItemsPanel` follows). */
const LOAD_ERROR = "Couldn't load activity.";

export interface BoardActivityFeedProps {
  boardId: number;
}

interface RowProps {
  boardId: number;
  activity: Activity;
}

/**
 * One feed row: the actor's avatar, their name in bold, the sentence, and the relative time
 * whose `title` carries the absolute one (Section 2.3.4).
 *
 * The sentence already contains the card's title (`lib/activity.ts` renders it from the names the
 * server denormalised at write time), so the row links the sentence itself rather than printing
 * the title a second time; a row that names no card is plain text.
 */
function ActivityRow({ boardId, activity }: RowProps): ReactElement | null {
  const sentence = activitySentence(activity);
  if (sentence === null) return null;

  const name = activity.user?.full_name ?? 'Kan Ban';
  const body = (
    <>
      <span className={styles.name}>{name}</span>
      {` ${sentence}`}
    </>
  );

  return (
    <li className={styles.row}>
      {activity.user === null ? (
        <span className={styles.systemAvatar} aria-hidden="true" />
      ) : (
        <Avatar name={activity.user.full_name} color={activity.user.avatar_color} size={32} />
      )}
      <div className={styles.content}>
        <p className={styles.sentence}>
          {activity.card_id === null ? (
            body
          ) : (
            <Link className={styles.link} to={`/b/${boardId}/c/${activity.card_id}`}>
              {body}
            </Link>
          )}
        </p>
        <time
          className={styles.time}
          dateTime={activity.created_at}
          title={formatDateTime(activity.created_at)}
        >
          {relativeTime(activity.created_at)}
        </time>
      </div>
    </li>
  );
}

/**
 * The board feed of the menu drawer (Section 2.3.4): `GET /api/boards/{board_id}/activity` paged
 * 50 rows at a time, newest first, with the next page fetched as the foot of the list scrolls into
 * view.
 *
 * The "Load more" button is that sentinel. It stays a real button so the feed can be paged from
 * the keyboard and in an environment without `IntersectionObserver`, and the observer simply
 * presses it for a reader who scrolls (Section 2.3.4 asks for infinite scroll; a list that can
 * only be advanced by a wheel gesture would fail Section 5.10).
 */
export function BoardActivityFeed({ boardId }: BoardActivityFeedProps): ReactElement {
  const { data, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useBoardActivity(boardId);
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinel.current;
    if (node === null || typeof IntersectionObserver !== 'function') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isPending) {
    return (
      <div className={styles.loading}>
        <Spinner size={24} label="Loading activity" />
      </div>
    );
  }

  if (isError) return <EmptyState message={LOAD_ERROR} />;

  const items = (data?.pages ?? []).flatMap((page) => page.items);

  if (items.length === 0) return <EmptyState message="No activity yet" />;

  return (
    <div className={styles.feed}>
      <ul className={styles.list}>
        {items.map((activity) => (
          <ActivityRow key={activity.id} boardId={boardId} activity={activity} />
        ))}
      </ul>

      {hasNextPage ? (
        <div ref={sentinel}>
          <Button fullWidth loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
