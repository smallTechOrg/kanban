import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import type { BoardSummary, SearchCard } from '@/api/types';
import { Kbd, Spinner, cx } from '@/components/ui';
import { LabelChip } from '@/components/ui/LabelChip';
import { SHORTCUT_ANCHOR_ATTR } from '@/hooks/useKeyboardShortcuts';
import { useMeta } from '@/hooks/useMeta';
import { useSearch } from '@/hooks/useSearch';
import { boardBackgroundStyle } from '@/lib/boardGroups';
import { useUiStore } from '@/store/uiStore';
import styles from './SearchPopover.module.css';

/** Section 2.1.1: the Boards group shows at most five rows. */
const MAX_BOARDS = 5;

/** Where one highlighted row goes; the arrows walk boards first, then cards (Section 2.1.1). */
function routeOf(
  boards: readonly BoardSummary[],
  cards: readonly SearchCard[],
  row: number,
): string | null {
  const board = boards[row];
  if (board !== undefined) return `/b/${String(board.id)}`;
  const card = cards[row - boards.length];
  if (card === undefined) return null;
  return `/b/${String(card.board_id)}/c/${String(card.id)}`;
}

/**
 * The top-bar search of Section 2.1.1: a 200px input that grows to 400px on focus, and the
 * results panel under it with the **Boards** group above the **Cards** group.
 *
 * The request, its 250 ms debounce and the two-character floor are `hooks/useSearch.ts`; this
 * component only paints the rows and moves the highlight. It is not built on the `Popover`
 * primitive: that one traps focus, and a search panel has to leave the caret in the input while
 * the reader keeps typing and walks the rows with the arrow keys. It still takes its open state
 * from `uiStore.openPopover`, so opening the search closes whatever else was open and the one
 * documented "exactly one at a time" rule holds (Section 2.1.2).
 *
 * The input carries the `/` shortcut's anchor attribute, which is how
 * `hooks/useKeyboardShortcuts.ts` focuses it from anywhere (Sections 2.8 and 5.9).
 */
export function SearchPopover(): ReactElement {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popover = useUiStore((state) => state.openPopover);
  const setOpenPopover = useUiStore((state) => state.setOpenPopover);
  const meta = useMeta().data;
  const { results, term, isFetching, isEnabled } = useSearch(input);

  const isOpen = popover !== null && popover.kind === 'search';
  const boards = (results?.boards ?? []).slice(0, MAX_BOARDS);
  const cards = results?.cards ?? [];
  const total = boards.length + cards.length;

  // A new answer starts at the first row rather than wherever the last one happened to end.
  useEffect(() => {
    setHighlight(0);
  }, [term]);

  // The panel is not the `Popover` primitive, so it needs the same outside-press dismissal.
  useEffect(() => {
    if (!isOpen) return undefined;
    function onPointerDown(event: MouseEvent): void {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
        setOpenPopover(null);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen, setOpenPopover]);

  function go(row: number): void {
    const to = routeOf(boards, cards, row);
    if (to === null) return;
    setOpenPopover(null);
    setInput('');
    inputRef.current?.blur();
    void navigate(to);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      setOpenPopover(null);
      inputRef.current?.blur();
      return;
    }
    if (total === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((current) => (current + delta + total) % total);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      go(highlight);
    }
  }

  return (
    <div className={styles.search} ref={rootRef}>
      <span className={styles.field}>
        <Search className={styles.icon} aria-hidden="true" />
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          placeholder="Search"
          aria-label="Search"
          autoComplete="off"
          value={input}
          {...{ [SHORTCUT_ANCHOR_ATTR]: 'search' }}
          onFocus={(event) => setOpenPopover({ kind: 'search', anchor: event.currentTarget })}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Kbd>/</Kbd>
      </span>

      {!isOpen || !isEnabled ? null : (
        <div className={styles.panel}>
          {total === 0 ? (
            <p className={styles.empty}>
              {isFetching ? (
                <Spinner size={24} label="Searching" />
              ) : (
                `We couldn't find anything matching '${term}'`
              )}
            </p>
          ) : (
            <>
              {boards.length === 0 ? null : (
                <>
                  <h3 className={styles.heading}>Spaces</h3>
                  <ul className={styles.list}>
                    {boards.map((board, index) => (
                      <li key={board.id}>
                        <button
                          type="button"
                          className={cx(styles.row, index === highlight && styles.highlighted)}
                          onMouseEnter={() => setHighlight(index)}
                          onClick={() => go(index)}
                        >
                          <span
                            className={styles.thumb}
                            style={boardBackgroundStyle(board, meta?.board_gradients ?? {})}
                            aria-hidden="true"
                          />
                          <span className={styles.name}>{board.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {cards.length === 0 ? null : (
                <>
                  <h3 className={styles.heading}>Cards</h3>
                  <ul className={styles.list}>
                    {cards.map((card, index) => {
                      const row = boards.length + index;
                      return (
                        <li key={card.id}>
                          <button
                            type="button"
                            className={cx(
                              styles.row,
                              styles.cardRow,
                              row === highlight && styles.highlighted,
                            )}
                            onMouseEnter={() => setHighlight(row)}
                            onClick={() => go(row)}
                          >
                            {card.labels.length === 0 ? null : (
                              <span className={styles.chips}>
                                {card.labels.map((label) => (
                                  <LabelChip
                                    key={`${label.color}-${label.name}`}
                                    className={styles.chip}
                                    name={label.name}
                                    color={label.color}
                                    tone={label.tone}
                                    palette={meta?.label_colors ?? {}}
                                  />
                                ))}
                              </span>
                            )}
                            <span className={styles.name}>{card.title}</span>
                            <span className={styles.where}>
                              {`in ${card.board_name} · ${card.list_name}`}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
