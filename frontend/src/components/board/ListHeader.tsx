import type { MouseEvent, ReactElement } from 'react';
import type { DraggableProvidedDragHandleProps } from '@hello-pangea/dnd';
import { MoreHorizontal } from 'lucide-react';
import { IconButton, InlineEditable } from '@/components/ui';
import { useUpdateList } from '@/hooks/useBoardMutations';
import { useUiStore } from '@/store/uiStore';
import { ListMenuPopover } from './ListMenuPopover';
import styles from './ListHeader.module.css';

export interface ListHeaderProps {
  boardId: number;
  listId: number;
  name: string;
  /** Active cards in the column, shown after the title (Section 2.4.2). */
  cardCount: number;
  /** How many of them survive the board filter; absent while no filter is active. */
  matchedCount?: number;
  /** False for observers, who may read the board but not write to it (Section 4.1). */
  canEdit: boolean;
  /** From the column's `LIST` Draggable: the whole header is the handle (Section 2.7). */
  handleProps: DraggableProvidedDragHandleProps | null;
}

/**
 * The fixed header of a column (Section 2.4.2): the inline-editable name wearing the 2px
 * `--focus` inset ring, its card count — "matched/total" while a filter is active — and the
 * "List actions" trigger. Enter and blur commit
 * the rename through `PATCH /api/lists/{list_id}`, Escape reverts, and an empty or unchanged
 * value is discarded — the contract of the `InlineEditable` primitive.
 *
 * The whole header is the drag handle of the list (Section 2.7), so nothing inside it may
 * swallow a pointer-down other than the two controls; `cursor: grab` is set here and
 * `dragHandleProps` is spread onto this element by the `LIST` Draggable in `ListColumn`.
 *
 * Which popover is open lives in `uiStore.openPopover`, the one field that keeps exactly one
 * popover open across the app (Section 5.13), so the column only renders the menu when that
 * entry names this list.
 */
export function ListHeader({
  boardId,
  listId,
  name,
  cardCount,
  matchedCount,
  canEdit,
  handleProps,
}: ListHeaderProps): ReactElement {
  const popover = useUiStore((state) => state.openPopover);
  const setOpenPopover = useUiStore((state) => state.setOpenPopover);
  const updateList = useUpdateList(boardId);

  const menuOpen =
    popover !== null && popover.kind === 'listMenu' && popover.props?.['listId'] === listId;

  return (
    <div
      className={styles.header}
      {...handleProps}
      // The library's handle props declare `role="button"`, which would make this element a
      // button wrapping the `h2`, the rename trigger and "List actions" — nested interactive
      // content, so the heading disappears and the two real buttons become part of one
      // "Rename list To Do 3 List actions" name. `CardTile` overrides it for the same reason;
      // the keyboard sensor finds handles by `data-rfd-drag-handle-draggable-id`, not by role,
      // and `tabIndex` from the same props still makes this the column's one drag handle.
      role={undefined}
    >
      <h2 className={styles.heading}>
        <InlineEditable
          className={styles.title}
          label={`Rename list ${name}`}
          value={name}
          disabled={!canEdit}
          onSave={(next) => updateList.mutate({ listId, name: next })}
        />
      </h2>

      <span className={styles.count}>
        {matchedCount === undefined ? cardCount : `${String(matchedCount)}/${String(cardCount)}`}
      </span>

      {canEdit ? (
        <IconButton
          label="List actions"
          // `ListDraggable` turns off the library's interactive-element blocking so the title
          // button can start a list drag, which also hands this button's mousedown to the drag
          // sensor: it claims the lock, `preventDefault`s the event (so the button never takes
          // focus and the popover has nowhere to return it) and a 5px wobble while clicking
          // would lift the column instead of opening the menu. Stopping the event here leaves
          // the rest of the header draggable.
          onMouseDown={(event: MouseEvent<HTMLButtonElement>) => event.stopPropagation()}
          onClick={(event: MouseEvent<HTMLButtonElement>) =>
            setOpenPopover({ kind: 'listMenu', anchor: event.currentTarget, props: { listId } })
          }
        >
          <MoreHorizontal aria-hidden="true" />
        </IconButton>
      ) : null}

      {menuOpen ? (
        <ListMenuPopover
          boardId={boardId}
          listId={listId}
          anchor={popover.anchor}
          onClose={() => setOpenPopover(null)}
        />
      ) : null}
    </div>
  );
}
