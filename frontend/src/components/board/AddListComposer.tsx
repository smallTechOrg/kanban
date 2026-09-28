import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, IconButton, TextInput } from '@/components/ui';
import { useCreateList } from '@/hooks/useBoardMutations';
import { useUiStore } from '@/store/uiStore';
import styles from './AddListComposer.module.css';

export interface AddListComposerProps {
  boardId: number;
  /** Section 2.4.5: a board with no lists opens the composer and relabels the button. */
  isEmptyBoard: boolean;
}

/**
 * The composer that sits after the last column (Section 2.4.4). Collapsed it is a 44px
 * translucent button; expanded it is a list-coloured box with an auto-focused input.
 *
 * Enter submits and keeps the composer open with an empty field, so lists can be typed one
 * after another; Escape and an outside click close it and discard the draft; an empty title
 * is ignored. Which composer is open lives in `uiStore.composer` (Section 5.13), the field
 * that also lets `ListMenuPopover` open a card composer in another column.
 */
export function AddListComposer({ boardId, isEmptyBoard }: AddListComposerProps): ReactElement {
  const composer = useUiStore((state) => state.composer);
  const setComposer = useUiStore((state) => state.setComposer);
  const createList = useCreateList(boardId);
  const [name, setName] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const expanded = composer !== null && composer.kind === 'list';

  // Section 2.4.5: the first thing a brand-new board shows is this composer, open.
  useEffect(() => {
    if (isEmptyBoard) setComposer({ kind: 'list' });
  }, [isEmptyBoard, setComposer]);

  const close = (): void => {
    setName('');
    setComposer(null);
  };

  // An outside click discards the draft, the same rule CardComposer follows (2.4.4).
  useEffect(() => {
    if (!expanded) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && wrapperRef.current?.contains(target) === false) {
        setName('');
        setComposer(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [expanded, setComposer]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const title = name.trim();
    if (title === '') return;
    createList.mutate({ name: title });
    setName('');
    inputRef.current?.focus();
    // The new column lands at the end of the canvas, which may be off screen (2.4.4).
    wrapperRef.current?.scrollIntoView({ block: 'nearest', inline: 'end' });
  }

  if (!expanded) {
    return (
      <div className={styles.wrapper} ref={wrapperRef}>
        <button
          type="button"
          className={styles.trigger}
          onClick={() => setComposer({ kind: 'list' })}
        >
          <Plus aria-hidden="true" className={styles.plus} />
          {isEmptyBoard ? 'Add a list' : 'Add another list'}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <form className={styles.box} onSubmit={submit}>
        <TextInput
          ref={inputRef}
          className={styles.input}
          value={name}
          autoFocus
          aria-label="List title"
          placeholder="Enter list title…"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        />
        <div className={styles.actions}>
          <Button type="submit" variant="primary">
            Add list
          </Button>
          <IconButton label="Close list composer" onClick={close}>
            <X aria-hidden="true" />
          </IconButton>
        </div>
      </form>
    </div>
  );
}
