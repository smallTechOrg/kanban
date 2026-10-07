import { useState, type MouseEvent, type ReactElement } from 'react';
import type { ArchivedType, CardSummary, ListOut } from '@/api/types';
import { Button, ConfirmPopover, EmptyState, Spinner, TextInput } from '@/components/ui';
import { useArchivedCards, useArchivedLists } from '@/hooks/useArchived';
import { useUnarchiveCard, useUnarchiveList, useDeleteList } from '@/hooks/useBoardMutations';
import { useDeleteCard } from '@/hooks/useCardMutations';
import styles from './ArchivedItemsPanel.module.css';

/** Section 2.6.4's copy, reused: deleting an archived row is the same irreversible act. */
const DELETE_CARD_BODY =
  "All actions will be removed from the activity feed and you won't be able to re-open the card. There is no undo.";
const DELETE_LIST_BODY =
  "All cards in this list will be deleted, and you won't be able to re-open the list. There is no undo.";

/** A failed read is not an empty archive, so it does not borrow the empty copy of Section 2.10. */
const LOAD_ERROR = "Couldn't load archived items.";

export interface ArchivedItemsPanelProps {
  boardId: number;
}

interface RowActionsProps {
  /** "Put back": the restore, which also drops the row from this listing. */
  onRestore: () => void;
  restoring: boolean;
  confirmTitle: string;
  confirmBody: string;
  onDelete: () => void;
  deleting: boolean;
}

/** The two links every archived row carries, with Delete behind a confirm popover (2.3.4). */
function RowActions({
  onRestore,
  restoring,
  confirmTitle,
  confirmBody,
  onDelete,
  deleting,
}: RowActionsProps): ReactElement {
  const [confirmAnchor, setConfirmAnchor] = useState<HTMLElement | null>(null);

  return (
    <p className={styles.actions}>
      <Button variant="link" loading={restoring} onClick={onRestore}>
        Put back
      </Button>
      <span className={styles.dot} aria-hidden="true" />
      <Button
        variant="link"
        onClick={(event: MouseEvent<HTMLButtonElement>) => setConfirmAnchor(event.currentTarget)}
      >
        Delete
      </Button>

      {confirmAnchor === null ? null : (
        <ConfirmPopover
          anchor={confirmAnchor}
          title={confirmTitle}
          body={confirmBody}
          loading={deleting}
          onClose={() => setConfirmAnchor(null)}
          onConfirm={onDelete}
        />
      )}
    </p>
  );
}

interface CardRowProps {
  boardId: number;
  card: CardSummary;
}

/**
 * One archived card: the tile miniature of Section 2.3.4 above its two links.
 *
 * The mutations are the board's own (`useUnarchiveCard`, `useDeleteCard`), so a restore lands in
 * the right list at its stored position and both cache entries stay consistent — this panel adds
 * no second copy of either rule.
 */
function ArchivedCardRow({ boardId, card }: CardRowProps): ReactElement {
  const restore = useUnarchiveCard(boardId);
  const remove = useDeleteCard(boardId, card.id);

  return (
    <li className={styles.row}>
      <div className={styles.miniature}>{card.title}</div>
      <RowActions
        onRestore={() => restore.mutate(card.id)}
        restoring={restore.isPending}
        confirmTitle="Delete card?"
        confirmBody={DELETE_CARD_BODY}
        onDelete={() => remove.mutate()}
        deleting={remove.isPending}
      />
    </li>
  );
}

interface ListRowProps {
  boardId: number;
  list: ListOut;
}

/** One archived list: its name, and the same two links. Its cards come back with it. */
function ArchivedListRow({ boardId, list }: ListRowProps): ReactElement {
  const restore = useUnarchiveList(boardId);
  const remove = useDeleteList(boardId);

  return (
    <li className={styles.row}>
      <div className={styles.listName}>{list.name}</div>
      <RowActions
        onRestore={() => restore.mutate(list.id)}
        restoring={restore.isPending}
        confirmTitle="Delete list?"
        confirmBody={DELETE_LIST_BODY}
        onDelete={() => remove.mutate(list.id)}
        deleting={remove.isPending}
      />
    </li>
  );
}

/**
 * The "Archived items" panel of the board menu drawer (Section 2.3.4): a search field, the
 * cards/lists switch, and one row per archived card or list with "Put back" and "Delete".
 *
 * Both halves are `useInfiniteQuery`s keyed `['archived', boardId, type, q]` (`hooks/useArchived`
 * debounces the search text, so the key changes once per pause), and only the visible half is
 * enabled. A restore or a delete invalidates the `['archived', boardId]` prefix from the mutation
 * itself, which is what makes the row leave without this panel tracking it.
 */
export function ArchivedItemsPanel({ boardId }: ArchivedItemsPanelProps): ReactElement {
  const [type, setType] = useState<ArchivedType>('cards');
  const [q, setQ] = useState('');
  const showCards = type === 'cards';
  const cards = useArchivedCards(boardId, q, showCards);
  const lists = useArchivedLists(boardId, q, !showCards);

  const cardRows = (cards.data?.pages ?? []).flatMap((entry) => entry.items);
  const listRows = (lists.data?.pages ?? []).flatMap((entry) => entry.items);
  const isEmpty = (showCards ? cardRows : listRows).length === 0;

  // The two halves are separate queries of different row types, so the shared chrome below
  // reads the four fields it needs rather than a union of the two query results.
  const isPending = showCards ? cards.isPending : lists.isPending;
  const isError = showCards ? cards.isError : lists.isError;
  const hasNextPage = showCards ? cards.hasNextPage : lists.hasNextPage;
  const isFetchingNextPage = showCards ? cards.isFetchingNextPage : lists.isFetchingNextPage;
  const fetchNextPage = (): void => {
    if (showCards) void cards.fetchNextPage();
    else void lists.fetchNextPage();
  };

  return (
    <div className={styles.panel}>
      <TextInput
        value={q}
        aria-label="Search archive"
        placeholder="Search archive…"
        onChange={(event) => setQ(event.target.value)}
      />

      <Button fullWidth onClick={() => setType(showCards ? 'lists' : 'cards')}>
        {showCards ? 'Switch to lists' : 'Switch to cards'}
      </Button>

      {isPending ? (
        <div className={styles.loading}>
          <Spinner size={24} label="Loading archived items" />
        </div>
      ) : isError ? (
        <EmptyState message={LOAD_ERROR} />
      ) : isEmpty ? (
        <EmptyState message={showCards ? 'No archived cards' : 'No archived lists'} />
      ) : (
        <ul className={styles.rows}>
          {showCards
            ? cardRows.map((card) => (
                <ArchivedCardRow key={card.id} boardId={boardId} card={card} />
              ))
            : listRows.map((list) => (
                <ArchivedListRow key={list.id} boardId={boardId} list={list} />
              ))}
        </ul>
      )}

      {hasNextPage ? (
        <Button fullWidth loading={isFetchingNextPage} onClick={fetchNextPage}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}
