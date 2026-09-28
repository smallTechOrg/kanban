import { useRef, type ReactElement, type ReactNode } from 'react';
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvidedDragHandleProps,
  type DragUpdate,
  type DropResult,
  type ResponderProvided,
} from '@hello-pangea/dnd';
import { cx } from '@/components/ui';
import { useBoardMeta, useBoardState } from '@/hooks/useBoardData';
import { useMoveCard, useMoveList } from '@/hooks/useBoardMutations';
import {
  BOARD_DROPPABLE_ID,
  CARD_DRAG_TYPE,
  LIST_DRAG_TYPE,
  isDragLocked,
  listDropId,
  moveFromDrop,
  parseListId,
  type CardOrder,
} from '@/lib/boardDnd';
import { useUiStore } from '@/store/uiStore';
import styles from './BoardDndContext.module.css';

/** Section 2.7, the keyboard instructions the library reads out when a handle takes focus. */
const DRAG_INSTRUCTIONS =
  'Press space bar to lift. Use the arrow keys to move, space bar to drop and escape to cancel.';

const NO_CARD_ORDER: CardOrder = {};

export interface BoardDndContextProps {
  boardId: number;
  children: ReactNode;
}

/**
 * The board's one `DragDropContext` (Sections 2.7 and 5.5). `BoardCanvas` wraps its columns in
 * it, `ListsDroppable` holds them, and each list body is a `CardsDroppable` of `CardTile`
 * draggables; the modal's checklists get their own context in M3.
 *
 * `onDragEnd` does nothing itself: `lib/boardDnd.ts` turns the drop into the move, and the
 * mutation hooks own the optimistic splice and the write-back of the server's `position`. The
 * only state kept here is `uiStore.isDragging`, which the realtime hook of M4 reads to queue
 * incoming events until the drop lands, so a remote refetch can never pull the dragged card out
 * from under the cursor.
 */
export function BoardDndContext({ boardId, children }: BoardDndContextProps): ReactElement {
  const setDragging = useUiStore((state) => state.setDragging);
  const moveCard = useMoveCard(boardId);
  const moveList = useMoveList(boardId);
  const state = useBoardState(boardId).data;

  // The drop is handled after a commit, so the handlers read the order through a ref: the
  // board can re-render between the lift and the drop (a neighbour's edit, the 30s refetch)
  // and a stale closure would compute the neighbours from the order as it was at lift time.
  const orderRef = useRef<CardOrder>(NO_CARD_ORDER);
  orderRef.current = state?.cardOrder ?? NO_CARD_ORDER;
  const listNamesRef = useRef<Record<number, string>>({});
  listNamesRef.current = Object.fromEntries(
    Object.values(state?.lists ?? {}).map((list) => [list.id, list.name]),
  );

  function onDragEnd(result: DropResult): void {
    setDragging(false);
    const outcome = moveFromDrop(result, orderRef.current);
    if (outcome.kind === 'card') moveCard.mutate(outcome.card);
    else if (outcome.kind === 'list') moveList.mutate(outcome.list);
  }

  /** The copy of Section 2.7; without a call the library announces its own default. */
  function onDragUpdate(update: DragUpdate, provided: ResponderProvided): void {
    const destination = update.destination;
    if (destination === undefined || destination === null) return;
    if (update.type !== CARD_DRAG_TYPE) return;
    const listId = parseListId(destination.droppableId);
    const name = listId === null ? undefined : listNamesRef.current[listId];
    if (name === undefined) return;
    provided.announce(
      `You have moved the card to position ${destination.index + 1} of list ${name}`,
    );
  }

  return (
    <DragDropContext
      onDragStart={() => setDragging(true)}
      onDragUpdate={onDragUpdate}
      onDragEnd={onDragEnd}
      dragHandleUsageInstructions={DRAG_INSTRUCTIONS}
    >
      {children}
    </DragDropContext>
  );
}

export interface ListsDroppableProps {
  /** The canvas row's own layout (`BoardCanvas` owns the scrolling and the padding). */
  className?: string;
  children: ReactNode;
}

/** The horizontal `type="LIST"` droppable the columns live in (Section 5.5). */
export function ListsDroppable({ className, children }: ListsDroppableProps): ReactElement {
  return (
    <Droppable droppableId={BOARD_DROPPABLE_ID} type={LIST_DRAG_TYPE} direction="horizontal">
      {(provided) => (
        <div
          ref={provided.innerRef}
          className={cx(styles.lists, className)}
          {...provided.droppableProps}
        >
          {children}
          {provided.placeholder}
        </div>
      )}
    </Droppable>
  );
}

/** What `ListColumn` needs from its `Draggable`: the header is the only handle (Section 2.7). */
export interface ListDragHandle {
  handleProps: DraggableProvidedDragHandleProps | null;
  isDragging: boolean;
}

export interface ListDraggableProps {
  boardId: number;
  listId: number;
  index: number;
  children: (handle: ListDragHandle) => ReactNode;
}

/**
 * One column as a `Draggable` inside `ListsDroppable`. The handle props are handed to the
 * caller rather than applied here, because only `ListHeader` may be the handle: the composers
 * and menus inside the column have to stay clickable.
 *
 * `disableInteractiveElementBlocking` is what makes "the whole header is the drag handle"
 * (Sections 2.4.2 and 2.7) true for a mouse. By default the library refuses to lift an item
 * when the gesture starts inside a `button`, `textarea` or `input`, and the header's rename
 * trigger is a full-width `<button>` — so a person grabbing the list by its title, the one
 * place they aim for, got nothing at all. The two children that must keep their native mouse
 * behaviour stop the event before the sensor's window listener sees it (`ListHeader`).
 */
export function ListDraggable({
  boardId,
  listId,
  index,
  children,
}: ListDraggableProps): ReactElement {
  const role = useBoardMeta(boardId).data?.my_role;

  return (
    <Draggable
      draggableId={listDropId(listId)}
      index={index}
      isDragDisabled={isDragLocked(role)}
      disableInteractiveElementBlocking
    >
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          className={cx(styles.column, snapshot.isDragging && styles.columnDragging)}
          {...provided.draggableProps}
        >
          {children({ handleProps: provided.dragHandleProps, isDragging: snapshot.isDragging })}
        </div>
      )}
    </Draggable>
  );
}

export interface CardsDroppableProps {
  listId: number;
  /** `CardList` owns the scrolling card region; this adds only the drop behaviour. */
  className?: string;
  children: ReactNode;
}

/** One list's vertical `type="CARD"` droppable, `droppableId = "list-{id}"` (Section 5.5). */
export function CardsDroppable({ listId, className, children }: CardsDroppableProps): ReactElement {
  return (
    <Droppable droppableId={listDropId(listId)} type={CARD_DRAG_TYPE}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          className={cx(styles.cards, className)}
          data-dragging-over={snapshot.isDraggingOver ? 'true' : undefined}
          {...provided.droppableProps}
        >
          {children}
          {provided.placeholder}
        </div>
      )}
    </Droppable>
  );
}
