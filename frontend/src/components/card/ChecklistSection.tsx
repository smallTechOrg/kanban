import { useEffect, useRef, useState, type ClipboardEvent, type ReactElement } from 'react';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import { CheckSquare } from 'lucide-react';
import { Button, ConfirmPopover, InlineEditable, Popover, Textarea, cx } from '@/components/ui';
import {
  useCreateChecklistItem,
  useCreateChecklistItems,
  useDeleteChecklist,
  useRenameChecklist,
} from '@/hooks/useCardMutations';
import type { Checklist } from '@/api/types';
import { checklistProgress } from '@/lib/badges';
import { isTempId } from '@/lib/boardState';
import { CHECKLIST_ITEM_DRAG_TYPE, checklistDropId, visibleItems } from '@/lib/cardDnd';
import { MIN_PASTE_LINES, pastedLines } from '@/lib/composerTokens';
import { ChecklistItemRow } from './ChecklistItemRow';
import { ProgressBar } from './ProgressBar';
import styles from './ChecklistSection.module.css';

export interface ChecklistSectionProps {
  boardId: number;
  cardId: number;
  checklist: Checklist;
  /** The section's slot in the card's checklists, which is the `Draggable` index. */
  index: number;
  /**
   * "Hide checked items". It is the modal's state, not this component's, because the rows a
   * checklist shows are the rows a drop's neighbours are read from, and `CardDetailModal` owns
   * the `DragDropContext` that has to know them (`lib/cardDnd.ts`).
   */
  hideChecked: boolean;
  onToggleHideChecked: () => void;
}

/**
 * One checklist on the card (Section 2.6.3): the renameable name, "Hide checked items (n)",
 * "Delete", the `ProgressBar`, the item rows and the inline "Add an item" composer, which the
 * plan keeps part of this component rather than a file of its own.
 *
 * The section is a `<Draggable>` of the card's one `CHECKLIST` droppable and holds its own
 * `CHECKLIST_ITEM` droppable: two types nested, which is what lets items move between
 * checklists while a lifted checklist can never land inside one (Sections 2.6.3 and 5.5).
 *
 * "Hide checked items" filters what is rendered, and the rendered rows are exactly what
 * `lib/cardDnd.ts` reads the drop neighbours from, so a drop into a filtered checklist lands
 * where it looks like it landed.
 */
export function ChecklistSection({
  boardId,
  cardId,
  checklist,
  index,
  hideChecked,
  onToggleHideChecked,
}: ChecklistSectionProps): ReactElement {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [paste, setPaste] = useState<{ text: string; lines: string[]; anchor: HTMLElement } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<HTMLElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const rename = useRenameChecklist(boardId, cardId);
  const remove = useDeleteChecklist(boardId, cardId);
  const addItem = useCreateChecklistItem(boardId, cardId);
  const addItems = useCreateChecklistItems(boardId, cardId);

  const locked = isTempId(checklist.id);
  const { done: checked, total } = checklistProgress(checklist);
  const visible = visibleItems(checklist.items, hideChecked);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  function submit(): void {
    const name = text.trim();
    if (name === '') return;
    addItem.mutate({ checklistId: checklist.id, name });
    setText('');
    // Section 2.6.3: Enter adds the item and leaves the composer open for the next one.
    inputRef.current?.focus();
  }

  function closeComposer(): void {
    setAdding(false);
    setText('');
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const pasted = event.clipboardData.getData('text');
    const lines = pastedLines(pasted);
    if (lines.length < MIN_PASTE_LINES) return;
    event.preventDefault();
    setPaste({ text: pasted, lines, anchor: event.currentTarget });
  }

  /** "Add N items": one request with `split_lines`, one row per non-empty line (Section 4.6). */
  function addMany(): void {
    if (paste === null) return;
    addItems.mutate({ checklistId: checklist.id, name: paste.text });
    setPaste(null);
    setText('');
    inputRef.current?.focus();
  }

  /** "Add as one item": the paste becomes one line the user can still edit before adding. */
  function addOne(): void {
    if (paste === null) return;
    const joined = paste.lines.join(' ');
    setText((current) => (current === '' ? joined : `${current} ${joined}`));
    setPaste(null);
    inputRef.current?.focus();
  }

  return (
    <Draggable
      draggableId={checklistDropId(checklist.id)}
      index={index}
      isDragDisabled={locked}
      // The handle contains the `InlineEditable` rename trigger, which is a `<button>`: the
      // library would refuse to lift from it, exactly as it did for the list header, and
      // `InlineEditable` already stops its own `mousedown` while the editor is open.
      disableInteractiveElementBlocking
    >
      {(provided, snapshot) => (
        <section
          ref={provided.innerRef}
          className={cx(styles.section, snapshot.isDragging && styles.dragging)}
          aria-label={checklist.name}
          {...provided.draggableProps}
        >
          <div className={styles.header}>
            <div
              className={styles.handle}
              {...provided.dragHandleProps}
              // Section 2.6.3 makes the header row the handle; the library's `role="button"`
              // would wrap the heading and the rename trigger in one control (`ListHeader`).
              role={undefined}
            >
              <CheckSquare className={styles.icon} aria-hidden="true" size={16} />
              <h3 className={styles.name}>
                <InlineEditable
                  value={checklist.name}
                  label={`Rename checklist ${checklist.name}`}
                  className={styles.nameInput}
                  disabled={locked}
                  onSave={(name) => rename.mutate({ checklistId: checklist.id, name })}
                />
              </h3>
            </div>

            {locked ? null : (
              <div className={styles.headerActions}>
                {checked === 0 ? null : (
                  <Button onClick={onToggleHideChecked}>
                    {`${hideChecked ? 'Show' : 'Hide'} checked items (${String(checked)})`}
                  </Button>
                )}
                <Button onClick={(event) => setConfirm(event.currentTarget)}>Delete</Button>
              </div>
            )}
          </div>

          <ProgressBar done={checked} total={total} label={checklist.name} />

          <Droppable droppableId={checklistDropId(checklist.id)} type={CHECKLIST_ITEM_DRAG_TYPE}>
            {(dropProvided) => (
              <div
                ref={dropProvided.innerRef}
                className={styles.items}
                {...dropProvided.droppableProps}
              >
                {visible.map((item, at) => (
                  <ChecklistItemRow
                    key={item.id}
                    boardId={boardId}
                    cardId={cardId}
                    item={item}
                    index={at}
                  />
                ))}
                {dropProvided.placeholder}
              </div>
            )}
          </Droppable>

          {locked ? null : (
            <div className={styles.footer}>
              {adding ? (
                <form
                  className={styles.composer}
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit();
                  }}
                >
                  <Textarea
                    ref={inputRef}
                    className={styles.composerInput}
                    aria-label="Add an item"
                    placeholder="Add an item"
                    minRows={2}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    onPaste={onPaste}
                    onSubmit={submit}
                    onCancel={closeComposer}
                  />
                  <div className={styles.composerFooter}>
                    <Button type="submit" variant="primary">
                      Add
                    </Button>
                    <Button onClick={closeComposer}>Cancel</Button>
                  </div>
                </form>
              ) : (
                <Button onClick={() => setAdding(true)}>Add an item</Button>
              )}
            </div>
          )}

          {confirm === null ? null : (
            <ConfirmPopover
              anchor={confirm}
              title="Delete checklist?"
              body="Deleting a checklist is permanent and there is no way to get it back."
              confirmLabel="Delete checklist"
              onConfirm={() => {
                setConfirm(null);
                remove.mutate(checklist.id);
              }}
              onClose={() => setConfirm(null)}
            />
          )}

          {paste === null ? null : (
            <Popover
              anchor={paste.anchor}
              title={`Add ${String(paste.lines.length)} items?`}
              onClose={() => setPaste(null)}
            >
              <p className={styles.pasteBody}>
                {`The text you pasted has ${String(paste.lines.length)} lines. Add one item per line, or keep it as a single item?`}
              </p>
              <Button variant="primary" fullWidth onClick={addMany}>
                {`Add ${String(paste.lines.length)} items`}
              </Button>
              <div className={styles.pasteSecond}>
                <Button fullWidth onClick={addOne}>
                  Add as one item
                </Button>
              </div>
            </Popover>
          )}
        </section>
      )}
    </Draggable>
  );
}
