import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { X } from 'lucide-react';
import { Button, IconButton, Popover, Textarea } from '@/components/ui';
import { useActiveCardCount, useLabels, useMembers } from '@/hooks/useBoardData';
import {
  useCreateCard,
  useCreateCards,
  type CreateCardVariables,
  type CreateCardsVariables,
} from '@/hooks/useBoardMutations';
import { useMeta } from '@/hooks/useMeta';
import type { SlotIndex } from '@/lib/boardState';
import { labelStyle, type LabelPalette } from '@/lib/colors';
import { MIN_PASTE_LINES, parseComposerTokens, pastedLines } from '@/lib/composerTokens';
import styles from './CardComposer.module.css';

const NO_PALETTE: LabelPalette = {};

/** Section 2.4.4: the composer's placeholder is also the hint that a pasted link works. */
const PLACEHOLDER = 'Enter a title or paste a link';

export interface CardComposerProps {
  boardId: number;
  listId: number;
  /**
   * Where the card lands when no `^` token overrides it: `'top'` from the list menu, the slot
   * below the current card for the `N` shortcut, and `undefined` (append) in the footer.
   */
  index?: SlotIndex;
  onClose: () => void;
}

/**
 * The expanded card composer of Section 2.4.4.
 *
 * Its whole reason to exist is rapid entry, so **Enter** submits and leaves the composer open
 * with an empty focused textarea, Shift+Enter inserts a newline, Ctrl/Cmd+Enter also submits,
 * and Escape or a click outside closes it and discards the draft. Every submit scrolls the
 * composer back into view, because the list has just grown by one tile.
 *
 * `#label`, `@member` and `^top` / `^bottom` / `^N` are parsed by `lib/composerTokens.ts` and
 * previewed as chips under the textarea. A multi-line paste asks whether it should become one
 * card per line and, if so, goes as a single `split_lines` request. A pasted URL is sent exactly
 * as pasted: the server turns it into a link attachment and stores its host as the title.
 */
export function CardComposer({ boardId, listId, index, onClose }: CardComposerProps): ReactElement {
  const [text, setText] = useState('');
  const [paste, setPaste] = useState<{ text: string; lines: string[]; anchor: HTMLElement } | null>(
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const labels = useLabels(boardId).data;
  const members = useMembers(boardId).data;
  const activeCount = useActiveCardCount(boardId, listId).data;
  const palette: LabelPalette = useMeta().data?.label_colors ?? NO_PALETTE;
  const { addCard } = useCreateCard(boardId);
  const createCards = useCreateCards(boardId);

  const parsed = useMemo(
    () => parseComposerTokens(text, { labels, members, activeCount }),
    [text, labels, members, activeCount],
  );

  function focusInput(): void {
    textareaRef.current?.focus();
    formRef.current?.scrollIntoView({ block: 'nearest' });
  }

  useEffect(() => {
    // Section 2.4.4: the composer is auto-focused and scrolled into view when it opens.
    textareaRef.current?.focus();
    formRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  useEffect(() => {
    function onPointerDown(event: MouseEvent): void {
      const form = formRef.current;
      // The paste confirmation is portalled outside the form, so its own clicks are not "outside".
      if (form === null || paste !== null) return;
      if (event.target instanceof Node && form.contains(event.target)) return;
      onClose();
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [onClose, paste]);

  function submit(): void {
    if (parsed.title === '') return;
    const variables: CreateCardVariables = { listId, title: parsed.title };
    const slot = parsed.index ?? index;
    if (slot !== undefined) variables.index = slot;
    if (parsed.label_ids.length > 0) variables.label_ids = parsed.label_ids;
    if (parsed.member_ids.length > 0) variables.member_ids = parsed.member_ids;
    addCard(variables);
    setText('');
    focusInput();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const pasted = event.clipboardData.getData('text');
    const lines = pastedLines(pasted);
    if (lines.length < MIN_PASTE_LINES) return;
    event.preventDefault();
    setPaste({ text: pasted, lines, anchor: event.currentTarget });
  }

  /** "Create N cards": one request with `split_lines`, one card per non-empty line. */
  function createMany(): void {
    if (paste === null) return;
    const variables: CreateCardsVariables = { listId, title: paste.text };
    if (index !== undefined) variables.index = index;
    createCards.mutate(variables);
    setPaste(null);
    setText('');
    focusInput();
  }

  /** "Just one card": the paste becomes one title the user can still edit before submitting. */
  function createOne(): void {
    if (paste === null) return;
    const joined = paste.lines.join(' ');
    setText((current) => (current === '' ? joined : `${current} ${joined}`));
    setPaste(null);
    focusInput();
  }

  return (
    <form
      ref={formRef}
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        ref={textareaRef}
        className={styles.input}
        aria-label="Card title"
        placeholder={PLACEHOLDER}
        minRows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onSubmit={submit}
        onCancel={onClose}
      />

      {parsed.tokens.length === 0 ? null : (
        <div className={styles.tokens}>
          {parsed.tokens.map((token, at) => {
            if (token.kind === 'label') {
              const { background, color } = labelStyle(token.color, 'normal', palette);
              return (
                <span
                  key={`${token.kind}-${at}`}
                  className={styles.token}
                  style={{ background, color }}
                >
                  {token.name === '' ? token.color : token.name}
                </span>
              );
            }
            return (
              <span key={`${token.kind}-${at}`} className={styles.token}>
                {token.kind === 'member' ? token.name : `Position ${String(token.index)}`}
              </span>
            );
          })}
        </div>
      )}

      <div className={styles.footer}>
        <Button type="submit" variant="primary">
          Add card
        </Button>
        <IconButton label="Close composer" onClick={onClose}>
          <X aria-hidden="true" />
        </IconButton>
      </div>

      {paste === null ? null : (
        <Popover
          anchor={paste.anchor}
          title={`Create ${paste.lines.length} cards?`}
          onClose={() => setPaste(null)}
        >
          <p className={styles.confirmBody}>
            {`The text you pasted has ${paste.lines.length} lines. Create one card per line, or keep it as a single card?`}
          </p>
          <Button variant="primary" fullWidth onClick={createMany}>
            {`Create ${paste.lines.length} cards`}
          </Button>
          <div className={styles.confirmSecond}>
            <Button fullWidth onClick={createOne}>
              Just one card
            </Button>
          </div>
        </Popover>
      )}
    </form>
  );
}
