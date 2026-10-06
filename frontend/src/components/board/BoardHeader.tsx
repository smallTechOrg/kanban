import { useRef, type ReactElement } from 'react';
import { Filter, MoreHorizontal, X } from 'lucide-react';
import { Button, IconButton, InlineEditable } from '@/components/ui';
import { useBoardMeta } from '@/hooks/useBoardData';
import { useFilterUrlSync } from '@/hooks/useBoardFilter';
import { SHORTCUT_ANCHOR_ATTR } from '@/hooks/useKeyboardShortcuts';
import { useUpdateBoard } from '@/hooks/useBoards';
import { activeFilterCount } from '@/lib/filter';
import { useUiStore } from '@/store/uiStore';
import { BoardMenuDrawer } from './BoardMenuDrawer';
import { FilterPopover } from './FilterPopover';
import styles from './BoardHeader.module.css';

export interface BoardHeaderProps {
  boardId: number;
}

/**
 * The 48px translucent band of Section 2.3.1: the inline-editable board name, the
 * Filter control and "Show menu".
 *
 * Filter is a plain button until something is selected, and then the solid white "N filters" pill
 * with the X that clears (Section 2.3.1). Both open `FilterPopover` through `uiStore.openPopover`,
 * the one field that keeps a single popover open across the app, so the `F` shortcut and the menu
 * drawer's "Search cards" row can open the same panel on the same anchor. The count itself is
 * `lib/filter.ts`'s `activeFilterCount`, and `useFilterUrlSync` (mounted here, because the mirror
 * has to work while the popover is closed) keeps the query string in step with `uiStore.filter`.
 *
 * "Show menu" toggles `uiStore.boardMenuOpen`, which this header renders as `BoardMenuDrawer` and
 * `BoardCanvas` reads to pad itself.
 */
export function BoardHeader({ boardId }: BoardHeaderProps): ReactElement | null {
  const { data: board } = useBoardMeta(boardId);
  const updateBoard = useUpdateBoard(boardId);
  const filterAnchor = useRef<HTMLDivElement | null>(null);
  const openPopover = useUiStore((state) => state.openPopover);
  const setOpenPopover = useUiStore((state) => state.setOpenPopover);
  const filter = useUiStore((state) => state.filter);
  const resetFilter = useUiStore((state) => state.resetFilter);
  const boardMenuOpen = useUiStore((state) => state.boardMenuOpen);
  const setBoardMenuOpen = useUiStore((state) => state.setBoardMenuOpen);
  useFilterUrlSync();

  const filterCount = activeFilterCount(filter);
  const filterOpen = openPopover !== null && openPopover.kind === 'filter';

  /**
   * Opens the popover on the whole Filter control, which is a wrapper element rather than the
   * button itself: the control swaps between a button and the pill, and "Search cards" in the
   * drawer opens it with no click of its own to read an anchor from.
   */
  function openFilter(): void {
    const anchor = filterAnchor.current;
    if (anchor !== null) setOpenPopover({ kind: 'filter', anchor });
  }

  if (board === undefined) return null;

  return (
    <header className={styles.header}>
      <h1 className={styles.heading}>
        <InlineEditable
          className={styles.name}
          // The board name is this button's visible text, so the accessible name has to carry
          // it too (WCAG 2.5.3): a bare "Space name" would make the `h1` announce that literal
          // string instead of the board, because a label on the only child wins the heading's
          // name computation. Same shape as `ListHeader`'s "Rename list <name>".
          label={`Rename space ${board.name}`}
          value={board.name}
          onSave={(name) => updateBoard.mutate({ name })}
        />
      </h1>


      <div className={styles.right}>
        <div
          className={styles.filter}
          ref={filterAnchor}
          // The `F` shortcut opens the same panel on the same anchor (Section 2.8).
          {...{ [SHORTCUT_ANCHOR_ATTR]: 'filter' }}
        >
          {filterCount === 0 ? (
            <Button
              variant="transparent-white"
              icon={<Filter aria-hidden="true" />}
              onClick={openFilter}
            >
              Filter
            </Button>
          ) : (
            <span className={styles.pill}>
              <button type="button" className={styles.pillButton} onClick={openFilter}>
                <Filter aria-hidden="true" className={styles.pillIcon} />
                {`${String(filterCount)} ${filterCount === 1 ? 'filter' : 'filters'}`}
              </button>
              <IconButton label="Clear all filters" size="sm" onClick={resetFilter}>
                <X aria-hidden="true" />
              </IconButton>
            </span>
          )}
        </div>
        <Button
          variant="transparent-white"
          icon={<MoreHorizontal aria-hidden="true" />}
          aria-expanded={boardMenuOpen}
          onClick={() => setBoardMenuOpen(!boardMenuOpen)}
        >
          Show menu
        </Button>
      </div>

      {filterOpen ? (
        <FilterPopover
          boardId={boardId}
          anchor={openPopover.anchor}
          onClose={() => setOpenPopover(null)}
        />
      ) : null}

      {boardMenuOpen ? (
        <BoardMenuDrawer
          boardId={boardId}
          onClose={() => setBoardMenuOpen(false)}
          onSearchCards={openFilter}
        />
      ) : null}
    </header>
  );
}
