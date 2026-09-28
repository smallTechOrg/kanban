import { useState, useRef, type ReactElement, type ReactNode } from 'react';
import type { SortListBy } from '@/api/lists';
import type { ListColorKey } from '@/api/types';
import {
  Button,
  Field,
  MenuRow,
  Popover,
  Select,
  Textarea,
  type PopoverNav,
} from '@/components/ui';
import { useBoardState } from '@/hooks/useBoardData';
import {
  useArchiveAllCards,
  useArchiveList,
  useCopyList,
  useMoveAllCards,
  useMoveList,
  useSortList,
  useUnarchiveCards,
  useUnarchiveList,
  useUpdateList,
} from '@/hooks/useBoardMutations';
import { useDestinationBoardOptions, useDestinationLists } from '@/hooks/useMoveTargets';
import { useMeta } from '@/hooks/useMeta';
import { useToast } from '@/hooks/useToast';
import { defaultSlot, destinationSlots, slotIndex, slotLabel } from '@/lib/moveTargets';
import type { Id } from '@/lib/boardState';
import { useUiStore } from '@/store/uiStore';
import styles from './ListMenuPopover.module.css';

/** The four orders of the "Sort by…" sub-view, in the order Trello lists them. */
const SORTS: readonly { by: SortListBy; label: string }[] = [
  { by: 'created_desc', label: 'Date created (newest first)' },
  { by: 'created_asc', label: 'Date created (oldest first)' },
  { by: 'title', label: 'Card name (alphabetically)' },
  { by: 'due', label: 'Due date' },
];

const ARCHIVE_ALL_BODY =
  'This will remove all the cards in this list from the board. To view archived cards and ' +
  "bring them back to the board, click 'Menu' > 'Archived items'.";

interface MoveListFormProps {
  boardId: number;
  listId: Id;
  /** The column's own 0-based slot on this board; the slot it sits in reads "(current)". */
  currentIndex: number;
  onMove: (variables: { listId: Id; index: number; toBoardId: Id }) => void;
  onDone: () => void;
}

/**
 * The "Move list" sub-view of Section 2.4.3: a Board select and a Position select over the
 * chosen board's columns, then `POST /api/lists/{list_id}/move` `{index, to_board_id?}`.
 *
 * It is a component rather than an element the parent builds, for the reason `LabelForm` is one
 * (CLAUDE.md section 8): `Popover` captures a view's content when it is pushed, so a Board select
 * that has to repaint the Position select below it cannot be state the parent holds. Its slot
 * arithmetic is `lib/moveTargets.ts`'s, the same function the card's Position select uses — a
 * column is not one of the siblings the server counts when it lands on its own board, so that
 * board offers one slot fewer, exactly as a card's own list does.
 */
function MoveListForm({
  boardId,
  listId,
  currentIndex,
  onMove,
  onDone,
}: MoveListFormProps): ReactElement {
  const [boardChoice, setBoardChoice] = useState<Id>(boardId);
  const [slotChoice, setSlotChoice] = useState<number | null>(null);

  const boardOptions = useDestinationBoardOptions(boardId);
  const { lists, isPending } = useDestinationLists(boardId, boardChoice);

  const isSameBoard = boardChoice === boardId;
  const slots = destinationSlots({
    cardCount: lists.length,
    currentIndex: isSameBoard ? currentIndex : null,
  });
  const slot =
    slotChoice !== null && slotChoice >= 1 && slotChoice <= slots.count
      ? slotChoice
      : defaultSlot(slots);

  function move(): void {
    const index = slotIndex(slot);
    if (!isSameBoard || index !== currentIndex) {
      onMove({ listId, index, toBoardId: boardChoice });
    }
    onDone();
  }

  return (
    <div className={styles.form}>
      <Field label="Board">
        {(control) => (
          <Select
            {...control}
            value={String(boardChoice)}
            onChange={(event) => {
              setBoardChoice(Number(event.target.value));
              setSlotChoice(null);
            }}
          >
            {boardOptions.map((board) => (
              <option key={board.id} value={String(board.id)}>
                {board.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Position">
        {(control) => (
          <Select
            {...control}
            value={String(slot)}
            disabled={isPending}
            onChange={(event) => setSlotChoice(Number(event.target.value))}
          >
            {Array.from({ length: slots.count }, (_, offset) => offset + 1).map((option) => (
              <option key={option} value={String(option)}>
                {slotLabel(option, slots.currentSlot)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Button variant="primary" disabled={isPending} onClick={move}>
        Move
      </Button>
    </div>
  );
}

export interface ListMenuPopoverProps {
  boardId: number;
  listId: number;
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
}

/**
 * "List actions" (Section 2.4.3): five divider-separated groups, every row wired to its
 * endpoint from Section 4.4 through `useBoardMutations`, and six nested sub-views pushed onto
 * the `Popover` view stack.
 *
 * A sub-view keeps its draft in the DOM (`defaultValue` plus a ref) instead of in React state,
 * because `Popover` captures a pushed view when it is pushed: a controlled input would keep
 * rendering the values this component held at that moment.
 *
 * Two rows are undoable (Section 2.10): archiving the list, and archiving its cards — whose
 * response carries `archived_ids`, so one request sends exactly those cards back.
 */
export function ListMenuPopover({
  boardId,
  listId,
  anchor,
  onClose,
}: ListMenuPopoverProps): ReactElement | null {
  const { data: state } = useBoardState(boardId);
  const { data: meta } = useMeta();
  const { show } = useToast();
  const setComposer = useUiStore((store) => store.setComposer);

  const updateList = useUpdateList(boardId);
  const copyList = useCopyList(boardId);
  const moveList = useMoveList(boardId);
  const sortList = useSortList(boardId);
  const moveAllCards = useMoveAllCards(boardId);
  const archiveAllCards = useArchiveAllCards(boardId);
  const unarchiveCards = useUnarchiveCards(boardId);
  const archiveList = useArchiveList(boardId);
  const unarchiveList = useUnarchiveList(boardId);

  const copyNameRef = useRef<HTMLTextAreaElement>(null);

  const list = state === undefined ? undefined : state.lists[listId];
  if (state === undefined || list === undefined) return null;

  const listOrder = state.listOrder;
  const currentIndex = listOrder.indexOf(listId);
  const others = listOrder.filter((id) => id !== listId);
  const colors = Object.entries(meta?.list_colors ?? {});

  const copyView = {
    title: 'Copy list',
    content: (nav: PopoverNav): ReactNode => {
      const create = (): void => {
        const name = copyNameRef.current?.value.trim() ?? '';
        if (name === '') return;
        copyList.mutate({ listId, name });
        nav.close();
      };
      return (
        <div className={styles.form}>
          <Field label="Name">
            {(control) => (
              <Textarea
                {...control}
                ref={copyNameRef}
                defaultValue={list.name}
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                onSubmit={create}
              />
            )}
          </Field>
          <Button variant="primary" onClick={create}>
            Create list
          </Button>
        </div>
      );
    },
  };

  const moveView = {
    title: 'Move list',
    content: (nav: PopoverNav): ReactNode => (
      <MoveListForm
        boardId={boardId}
        listId={listId}
        currentIndex={currentIndex}
        onMove={(variables) => moveList.mutate(variables)}
        onDone={nav.close}
      />
    ),
  };

  const sortView = {
    title: 'Sort by',
    content: (nav: PopoverNav): ReactNode =>
      SORTS.map((sort) => (
        <MenuRow
          key={sort.by}
          onClick={() => {
            sortList.mutate({ listId, by: sort.by });
            nav.close();
          }}
        >
          {sort.label}
        </MenuRow>
      )),
  };

  const colorView = {
    title: 'Change list color',
    content: (nav: PopoverNav): ReactNode => (
      <div className={styles.form}>
        <ul className={styles.swatches}>
          {colors.map(([key, value]) => (
            <li key={key}>
              <button
                type="button"
                className={styles.swatch}
                style={{ background: value }}
                aria-label={key}
                aria-pressed={list.color === key}
                onClick={() => {
                  // GET /api/meta is the only source of these keys, and it publishes exactly
                  // the ten of `ListColorKey` (Section 4.4, CLAUDE.md section 3).
                  updateList.mutate({ listId, color: key as ListColorKey });
                  nav.close();
                }}
              />
            </li>
          ))}
        </ul>
        <Button
          fullWidth
          onClick={() => {
            updateList.mutate({ listId, color: null });
            nav.close();
          }}
        >
          Remove color
        </Button>
      </div>
    ),
  };

  const moveAllView = {
    title: 'Move all cards in this list',
    content: (nav: PopoverNav): ReactNode =>
      others.length === 0 ? (
        <p className={styles.body}>This board has no other list to move the cards to.</p>
      ) : (
        others.map((id) => (
          <MenuRow
            key={id}
            onClick={() => {
              moveAllCards.mutate({ listId, toListId: id });
              nav.close();
            }}
          >
            {state.lists[id]?.name ?? ''}
          </MenuRow>
        ))
      ),
  };

  const archiveAllView = {
    title: 'Archive all cards in this list?',
    content: (nav: PopoverNav): ReactNode => (
      <div className={styles.form}>
        <p className={styles.body}>{ARCHIVE_ALL_BODY}</p>
        <Button
          variant="danger"
          fullWidth
          onClick={() => {
            nav.close();
            // The toast needs `archived_ids` from the response, and closing the popover
            // unmounts this component before it lands — which is exactly when TanStack drops
            // the callbacks passed to `mutate`. `mutateAsync` settles regardless; the red
            // error toast stays the mutation's own job, so the catch only keeps the rejection
            // handled.
            void archiveAllCards
              .mutateAsync(listId)
              .then(({ archived, archived_ids }) => {
                if (archived === 0) return;
                show(`${archived} ${archived === 1 ? 'card' : 'cards'} archived`, 'neutral', {
                  label: 'Undo',
                  onClick: () => unarchiveCards.mutate({ listId, cardIds: archived_ids }),
                });
              })
              .catch(() => undefined);
          }}
        >
          Archive all
        </Button>
      </div>
    ),
  };

  return (
    <Popover anchor={anchor} title="List actions" onClose={onClose}>
      {(nav) => (
        <>
          <MenuRow
            onClick={() => {
              setComposer({ kind: 'card', listId, index: 'top' });
              nav.close();
            }}
          >
            Add card
          </MenuRow>
          <MenuRow onClick={() => nav.push(copyView)}>Copy list…</MenuRow>
          <MenuRow onClick={() => nav.push(moveView)}>Move list…</MenuRow>
          <MenuRow disabled tooltip="List watching is not available yet" onClick={nav.close}>
            Watch
          </MenuRow>

          <hr className={styles.divider} />
          <MenuRow onClick={() => nav.push(sortView)}>Sort by…</MenuRow>

          <hr className={styles.divider} />
          <MenuRow onClick={() => nav.push(colorView)}>Change list color</MenuRow>

          <hr className={styles.divider} />
          <MenuRow onClick={() => nav.push(moveAllView)}>Move all cards in this list…</MenuRow>
          <MenuRow onClick={() => nav.push(archiveAllView)}>
            Archive all cards in this list…
          </MenuRow>

          <hr className={styles.divider} />
          <MenuRow
            onClick={() => {
              archiveList.mutate(listId);
              nav.close();
              show('List archived', 'neutral', {
                label: 'Undo',
                onClick: () => unarchiveList.mutate(listId),
              });
            }}
          >
            Archive this list
          </MenuRow>
        </>
      )}
    </Popover>
  );
}
