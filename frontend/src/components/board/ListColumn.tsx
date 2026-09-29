import { memo, type ReactElement } from 'react';
import { Plus } from 'lucide-react';
import { useActiveCardCount, useList, useMatchedCardCount } from '@/hooks/useBoardData';
import { useBoardFilter } from '@/hooks/useBoardFilter';
import { useMeta } from '@/hooks/useMeta';
import { listBackground, type ListPalette } from '@/lib/colors';
import { useUiStore } from '@/store/uiStore';
import { ListDraggable } from './BoardDndContext';
import { CardComposer } from './CardComposer';
import { CardList } from './CardList';
import { ListHeader } from './ListHeader';
import styles from './ListColumn.module.css';

const NO_PALETTE: ListPalette = {};

export interface ListColumnProps {
  boardId: number;
  listId: number;
  /** The column's slot in `listOrder`, which is its `Draggable` index (Section 5.5). */
  index: number;
}

/**
 * One 272px column (Section 2.4.1): a fixed header, the scrolling card region, and a fixed
 * footer holding the card composer. Its background is `--list-bg`, or the hex `GET /api/meta`
 * publishes for `lists.color` when the list has one.
 *
 * `React.memo` plus the per-list selectors of Section 5.11 keep a change to one column from
 * re-rendering the others: `useList` and `useActiveCardCount` return the same values for every
 * untouched list, so only the two lists a move touches re-render.
 *
 * The composer is opened from `uiStore.composer`, which also lets `ListMenuPopover` in another
 * column open this one's composer at the top ("Add card", Section 2.4.3).
 *
 * While a filter is active the header's count reads "matched/total" (Section 2.4.2). The column
 * asks for that number rather than for the rows it is counted from: the predicate is
 * `hooks/useBoardFilter.ts`, the same one `CardList` hides a tile with, so the number in the
 * header can never disagree with what the column shows, and a selector that answers with a
 * count keeps every card edit that does not change it from repainting the header, the composer
 * and the hundred `React.memo` comparisons below them (Section 5.11).
 */
function ListColumnView({ boardId, listId, index }: ListColumnProps): ReactElement | null {
  const list = useList(boardId, listId).data;
  const cardCount = useActiveCardCount(boardId, listId).data ?? 0;
  const { active: filterActive, matches } = useBoardFilter(boardId);
  const matchedCount = useMatchedCardCount(boardId, listId, filterActive ? matches : null).data;
  const palette: ListPalette = useMeta().data?.list_colors ?? NO_PALETTE;
  const composer = useUiStore((state) => state.composer);
  const setComposer = useUiStore((state) => state.setComposer);

  if (list === undefined) return null;

  const openComposer =
    composer !== null && composer.kind === 'card' && composer.listId === listId ? composer : null;
  const composerAtTop = openComposer?.index === 'top';
  const closeComposer = (): void => setComposer(null);

  return (
    <ListDraggable listId={listId} index={index}>
      {({ handleProps }) => (
        <section
          className={styles.column}
          style={{ background: listBackground(list.color, palette) }}
          aria-label={list.name}
        >
          <ListHeader
            boardId={boardId}
            listId={listId}
            name={list.name}
            cardCount={cardCount}
            matchedCount={matchedCount}
            handleProps={handleProps}
          />

          {composerAtTop ? (
            <div className={styles.topComposer}>
              <CardComposer boardId={boardId} listId={listId} index="top" onClose={closeComposer} />
            </div>
          ) : null}

          <CardList boardId={boardId} listId={listId} />

          <div className={styles.footer}>
            {openComposer !== null && !composerAtTop ? (
              <CardComposer
                boardId={boardId}
                listId={listId}
                index={openComposer.index}
                onClose={closeComposer}
              />
            ) : composerAtTop ? null : (
              <button
                type="button"
                className={styles.addCard}
                onClick={() => setComposer({ kind: 'card', listId })}
              >
                <Plus aria-hidden="true" className={styles.plus} />
                Add a card
              </button>
            )}
          </div>
        </section>
      )}
    </ListDraggable>
  );
}

export const ListColumn = memo(ListColumnView);
