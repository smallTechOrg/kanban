import { useState, type ReactElement } from 'react';
import { Avatar, Button, EmptyState, MarkdownEditor, MarkdownView, Spinner } from '@/components/ui';
import { useMe } from '@/hooks/useAuth';
import { useBoardMeta } from '@/hooks/useBoardData';
import { useCardFeed } from '@/hooks/useCard';
import { useDeleteComment, useUpdateComment } from '@/hooks/useCardMutations';
import type { Activity, Comment, FeedItem } from '@/api/types';
import { activitySentence } from '@/lib/activity';
import { isTempId } from '@/lib/boardState';
import { formatDateTime, relativeTime } from '@/lib/dates';
import { useUiStore } from '@/store/uiStore';
import styles from './ActivityFeed.module.css';

/** A failed read is not an empty feed (the same rule `BoardActivityFeed` follows). */
const LOAD_ERROR = "Couldn't load activity.";

export interface ActivityFeedProps {
  boardId: number;
  cardId: number;
}

interface CommentRowProps {
  boardId: number;
  cardId: number;
  comment: Comment;
  /** The author may edit and delete; a board admin may delete anyone's (Section 4.6). */
  canEdit: boolean;
  canDelete: boolean;
}

function CommentRow({
  boardId,
  cardId,
  comment,
  canEdit,
  canDelete,
}: CommentRowProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const update = useUpdateComment(boardId, cardId);
  const remove = useDeleteComment(boardId, cardId);

  function save(): void {
    const body = draft.trim();
    setEditing(false);
    if (body === '' || body === comment.body) return;
    update.mutate({ commentId: comment.id, body });
  }

  return (
    <li className={styles.row}>
      <Avatar name={comment.user.full_name} color={comment.user.avatar_color} size={32} />
      <div className={styles.content}>
        <p className={styles.meta}>
          <span className={styles.name}>{comment.user.full_name}</span>
          <time
            className={styles.time}
            dateTime={comment.created_at}
            title={formatDateTime(comment.created_at)}
          >
            {relativeTime(comment.created_at)}
          </time>
          {comment.edited_at === null ? null : <span className={styles.edited}>(edited)</span>}
        </p>

        {editing ? (
          <MarkdownEditor
            value={draft}
            label="Edit comment"
            onChange={setDraft}
            onSave={save}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <div className={styles.bubble}>
              <MarkdownView>{comment.body}</MarkdownView>
            </div>
            <p className={styles.actions}>
              {canEdit ? (
                <Button
                  variant="link"
                  onClick={() => {
                    setDraft(comment.body);
                    setEditing(true);
                  }}
                >
                  Edit
                </Button>
              ) : null}
              {canEdit && canDelete ? <span className={styles.dot} aria-hidden="true" /> : null}
              {canDelete ? (
                <Button variant="link" onClick={() => remove.mutate(comment.id)}>
                  Delete
                </Button>
              ) : null}
            </p>
          </>
        )}
      </div>
    </li>
  );
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
      {activity.user === null ? (
        <span className={styles.systemAvatar} aria-hidden="true" />
      ) : (
        <Avatar name={activity.user.full_name} color={activity.user.avatar_color} size={32} />
      )}
      <div className={styles.content}>
        <p className={styles.sentence}>
          <span className={styles.name}>{activity.user?.full_name ?? 'Kan Ban'}</span>
          {` ${sentence}`}
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

/** The key of one feed row: the comment id, or the activity id it was written by. */
function rowKey(item: FeedItem): string {
  return item.kind === 'comment'
    ? `comment-${String(item.comment.id)}`
    : `activity-${String(item.activity.id)}`;
}

/**
 * The card feed of Section 2.6.3: comments and activity rows newest first, paged with
 * `before=<activities.id>` behind a "Load more" button.
 *
 * Not one sentence is written here. `lib/activity.ts` renders every one of them from the
 * `type` + `data` the server stored, which is what makes the feed survive a rename, and it is
 * told which card is open so `card_title` reads "this card". A type with no sentence (a reorder
 * that only travels over SSE) renders nothing at all rather than a broken line.
 *
 * "Show details" is `uiStore.activityDetails`, and it is part of the query key: `details=0`
 * returns comments only, so the two modes must not share pages (`hooks/useCard.ts`).
 */
export function ActivityFeed({ boardId, cardId }: ActivityFeedProps): ReactElement {
  const details = useUiStore((state) => state.activityDetails);
  const feed = useCardFeed(cardId, details);
  const me = useMe().data;
  const isAdmin = useBoardMeta(boardId).data?.my_role === 'admin';

  if (feed.isPending) {
    return (
      <div className={styles.loading}>
        <Spinner size={24} label="Loading activity" />
      </div>
    );
  }

  if (feed.isError) return <EmptyState message={LOAD_ERROR} />;

  const items = (feed.data?.pages ?? []).flatMap((page) => page.items);

  if (items.length === 0) {
    return <EmptyState message={details ? 'No activity yet' : 'No comments yet'} />;
  }

  return (
    <div>
      <ul className={styles.feed}>
        {items.map((item) =>
          item.kind === 'comment' ? (
            <CommentRow
              key={rowKey(item)}
              boardId={boardId}
              cardId={cardId}
              comment={item.comment}
              canEdit={!isTempId(item.comment.id) && item.comment.user.id === me?.id}
              canDelete={!isTempId(item.comment.id) && (item.comment.user.id === me?.id || isAdmin)}
            />
          ) : (
            <ActivityRow key={rowKey(item)} activity={item.activity} openCardId={cardId} />
          ),
        )}
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
