import { useEffect, useRef, useState, type ClipboardEvent, type ReactElement } from 'react';
import { Droppable } from '@hello-pangea/dnd';
import { CheckSquare } from 'lucide-react';
import { Button, EmptyState, Popover, Textarea } from '@/components/ui';
import { useCreateItem, useCreateItems } from '@/hooks/useCardMutations';
import type { CardItem } from '@/api/types';
import { itemProgress } from '@/lib/badges';
import { ITEM_DRAG_TYPE, itemsDropId, visibleItems } from '@/lib/cardDnd';
import { MIN_PASTE_LINES, pastedLines } from '@/lib/composerTokens';
import { ItemRow } from './ItemRow';
import { ProgressBar } from './ProgressBar';
import styles from './ItemsSection.module.css';

/** Section 2.10's empty state: a card with no items still invites the first one. */
const EMPTY_BLURB = 'No items yet. Add one to start a list on this card.';

export interface ItemsSectionProps {
  boardId: number;
  cardId: number;
  items: readonly CardItem[];
  /**
   * "Hide checked items". It is the modal's state, not this component's, because the rows the
   * section shows are the rows a drop's neighbours are read from, and `CardDetailModal` owns the
   * `DragDropContext` that has to know them (`lib/cardDnd.ts`).
   */
  hideChecked: boolean;
  onToggleHideChecked: () => void;
}

/**
 * The card's items (Section 2.6.3): "Hide checked items (n)", the `ProgressBar`, the item rows
 * and the inline "Add an item" composer, which the plan keeps part of this component rather than
 * a file of its own.
 *
 * There is no named checklist to create first, so the section always renders and "Add an item" is
 * the whole gesture. It holds the card's one `ITEM` droppable; "Hide checked items" filters what
 * is rendered, and the rendered rows are exactly what `lib/cardDnd.ts` reads the drop neighbours
 * from, so a drop into a filtered list lands where it looks like it landed.
 */
export function ItemsSection({
  boardId,
  cardId,
  items,
  hideChecked,
  onToggleHideChecked,
}: ItemsSectionProps): ReactElement {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [paste, setPaste] = useState<{ text: string; lines: string[]; anchor: HTMLElement } | null>(
    null,
  );
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const addItem = useCreateItem(boardId, cardId);
  const addItems = useCreateItems(boardId, cardId);

  const { done: checked, total } = itemProgress(items);
  const visible = visibleItems(items, hideChecked);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  function submit(): void {
    const name = text.trim();
    if (name === '') return;
    addItem.mutate({ name });
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
    addItems.mutate({ name: paste.text });
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
    <section className={styles.section} aria-label="Items">
      <div className={styles.header}>
        <CheckSquare className={styles.icon} aria-hidden="true" size={16} />
        <h3 className={styles.name}>Items</h3>
        {checked === 0 ? null : (
          <div className={styles.headerActions}>
            <Button onClick={onToggleHideChecked}>
              {`${hideChecked ? 'Show' : 'Hide'} checked items (${String(checked)})`}
            </Button>
          </div>
        )}
      </div>

      {total === 0 ? null : <ProgressBar done={checked} total={total} label="Items" />}

      <Droppable droppableId={itemsDropId(cardId)} type={ITEM_DRAG_TYPE}>
        {(dropProvided) => (
          <div ref={dropProvided.innerRef} className={styles.items} {...dropProvided.droppableProps}>
            {visible.map((item, at) => (
              <ItemRow key={item.id} boardId={boardId} cardId={cardId} item={item} index={at} />
            ))}
            {dropProvided.placeholder}
          </div>
        )}
      </Droppable>

      {total === 0 && !adding ? <EmptyState message={EMPTY_BLURB} /> : null}

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
  );
}
