import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { Calendar, MoreHorizontal, X } from 'lucide-react';
import { Button, IconButton, MenuRow, Popover, Textarea, cx } from '@/components/ui';
import { useDeleteItem, useUpdateItem } from '@/hooks/useCardMutations';
import type { CardItem } from '@/api/types';
import { isTempId } from '@/lib/boardState';
import { itemDragId } from '@/lib/cardDnd';
import { formatDate, formatDateTime } from '@/lib/dates';
import { ItemDuePopover } from './ItemDuePopover';
import styles from './ItemRow.module.css';

export interface ItemRowProps {
  boardId: number;
  cardId: number;
  item: CardItem;
  /** The row's slot in the card's rendered item order, which is the `Draggable` index. */
  index: number;
}

/**
 * One item row (Section 2.6.3): the 16px checkbox, the item text and its due badge, and on
 * hover the calendar icon plus the three-dots menu with "Delete". Clicking the text opens the
 * inline editor — a `Textarea`, a `primary` "Save" and a close X.
 *
 * The row is a `<Draggable>` of the card's `ITEM` droppable, so an item can be reordered within
 * its card; the drop itself is decided by `lib/cardDnd.ts` in `CardDetailModal`.
 *
 * A row whose id is still negative is an optimistic insert the server has not confirmed: it
 * cannot be dragged, and its menu stays shut, because every one of those endpoints addresses the
 * item by an id that does not exist yet.
 */
export function ItemRow({ boardId, cardId, item, index }: ItemRowProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.name);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [duePanel, setDuePanel] = useState<HTMLElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const update = useUpdateItem(boardId, cardId);
  const remove = useDeleteItem(boardId, cardId);

  const locked = isTempId(item.id);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (input === null) return;
    input.focus();
    input.select();
  }, [editing]);

  function startEditing(): void {
    if (locked) return;
    setDraft(item.name);
    setEditing(true);
  }

  function save(): void {
    const next = draft.trim();
    setEditing(false);
    if (next === '' || next === item.name) return;
    update.mutate({ itemId: item.id, name: next });
  }

  if (editing) {
    return (
      <div className={styles.editor}>
        <Textarea
          ref={inputRef}
          className={styles.editorInput}
          aria-label="Item name"
          value={draft}
          minRows={2}
          onChange={(event) => setDraft(event.target.value)}
          onSubmit={save}
          onCancel={() => setEditing(false)}
        />
        <div className={styles.editorFooter}>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
          <IconButton label="Cancel editing" onClick={() => setEditing(false)}>
            <X aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    );
  }

  return (
    <Draggable
      draggableId={itemDragId(item.id)}
      index={index}
      isDragDisabled={locked}
      // The handle below is a `<button>`, which the library refuses to lift from by default
      // (`is-event-in-interactive-element.ts`) — the same reason `ListDraggable` turns the
      // blocking off. Only the text is the handle, so the checkbox and the menu keep their
      // native mouse behaviour and the sensor never sees their events at all.
      disableInteractiveElementBlocking
    >
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          className={cx(styles.row, snapshot.isDragging && styles.dragging)}
          {...provided.draggableProps}
        >
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={item.is_checked}
            disabled={locked}
            aria-label={item.name}
            onChange={(event) =>
              update.mutate({ itemId: item.id, is_checked: event.target.checked })
            }
          />

          <button
            type="button"
            className={cx(styles.text, item.is_checked && styles.checked)}
            disabled={locked}
            onClick={startEditing}
            {...provided.dragHandleProps}
            // The handle props declare `role="button"`, which this element already is; keeping
            // the attribute would only restate it, and the keyboard sensor finds handles by
            // `data-rfd-drag-handle-draggable-id` (the note in `CardTile`).
            role={undefined}
          >
            {item.name}
          </button>

          {item.due_at === null ? null : (
            <span className={styles.due} title={formatDateTime(item.due_at)}>
              {formatDate(item.due_at)}
            </span>
          )}

          {locked ? null : (
            <div className={styles.actions}>
              <IconButton
                size="sm"
                label={`Set due date for ${item.name}`}
                tooltip="Due date"
                onClick={(event) => setDuePanel(event.currentTarget)}
              >
                <Calendar aria-hidden="true" />
              </IconButton>
              <IconButton
                size="sm"
                label={`Item actions for ${item.name}`}
                tooltip="Item actions"
                onClick={(event) => setMenu(event.currentTarget)}
              >
                <MoreHorizontal aria-hidden="true" />
              </IconButton>
            </div>
          )}

          {duePanel === null ? null : (
            <ItemDuePopover
              boardId={boardId}
              cardId={cardId}
              item={item}
              anchor={duePanel}
              onClose={() => setDuePanel(null)}
            />
          )}

          {menu === null ? null : (
            <Popover anchor={menu} title="Item actions" onClose={() => setMenu(null)}>
              <MenuRow
                onClick={() => {
                  setMenu(null);
                  remove.mutate(item.id);
                }}
              >
                Delete
              </MenuRow>
            </Popover>
          )}
        </div>
      )}
    </Draggable>
  );
}
