import { useRef, useState, type MouseEvent, type ReactElement } from 'react';
import { Filter, Globe, Lock, MoreHorizontal, UserPlus, Users, X } from 'lucide-react';
import type { Visibility } from '@/api/types';
import { StarButton } from '@/components/home/StarButton';
import { Avatar, Button, IconButton, InlineEditable, MenuRow, Popover } from '@/components/ui';
import { useBoardMeta, useMembers } from '@/hooks/useBoardData';
import { useFilterUrlSync } from '@/hooks/useBoardFilter';
import { SHORTCUT_ANCHOR_ATTR } from '@/hooks/useKeyboardShortcuts';
import { useUpdateBoard } from '@/hooks/useBoards';
import { activeFilterCount } from '@/lib/filter';
import { useUiStore } from '@/store/uiStore';
import { BoardMenuDrawer } from './BoardMenuDrawer';
import { FilterPopover } from './FilterPopover';
import { ShareBoardModal } from './ShareBoardModal';
import styles from './BoardHeader.module.css';

/** Section 2.3.1: at most five stacked avatars, then one "+N" chip. */
const MAX_AVATARS = 5;

interface VisibilityOption {
  name: string;
  description: string;
  icon: ReactElement;
}

/** The three 48px rows of the "Change visibility" popover. Informational in v1 (2.2.1). */
const VISIBILITIES: Record<Visibility, VisibilityOption> = {
  private: {
    name: 'Private',
    description: 'Only board members can see and edit this board.',
    icon: <Lock aria-hidden="true" />,
  },
  workspace: {
    name: 'Workspace',
    description: 'Everyone in this workspace can see this board.',
    icon: <Users aria-hidden="true" />,
  },
  public: {
    name: 'Public',
    description: 'Anyone who can reach this server can see this board.',
    icon: <Globe aria-hidden="true" />,
  },
};

/** Trello's order, which is also the order of widening access. */
const VISIBILITY_ORDER: readonly Visibility[] = ['private', 'workspace', 'public'];

export interface BoardHeaderProps {
  boardId: number;
}

/**
 * The 48px translucent band of Section 2.3.1: the inline-editable board name, the star, the
 * visibility popover, the stacked member avatars, the Filter control and "Show menu".
 *
 * Filter is a plain button until something is selected, and then the solid white "N filters" pill
 * with the X that clears (Section 2.3.1). Both open `FilterPopover` through `uiStore.openPopover`,
 * the one field that keeps a single popover open across the app, so the `F` shortcut and the menu
 * drawer's "Search cards" row can open the same panel on the same anchor. The count itself is
 * `lib/filter.ts`'s `activeFilterCount`, and `useFilterUrlSync` (mounted here, because the mirror
 * has to work while the popover is closed) keeps the query string in step with `uiStore.filter`.
 *
 * "Show menu" toggles `uiStore.boardMenuOpen`, which this header renders as `BoardMenuDrawer` and
 * `BoardCanvas` reads to pad itself. Invite opens `ShareBoardModal` and renders for admins only,
 * because adding a member and changing a role are admin-only endpoints (Sections 4.3 and 6.6).
 *
 * Observers cannot write to a board (403 from every mutating route, Section 4.1), so the name
 * and the visibility button are inert for them rather than failing after the click.
 */
export function BoardHeader({ boardId }: BoardHeaderProps): ReactElement | null {
  const { data: board } = useBoardMeta(boardId);
  const { data: members } = useMembers(boardId);
  const updateBoard = useUpdateBoard(boardId);
  const [visibilityAnchor, setVisibilityAnchor] = useState<HTMLElement | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
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

  const canEdit = board.my_role !== 'observer';
  const current = VISIBILITIES[board.visibility];
  const shown = (members ?? []).slice(0, MAX_AVATARS);
  const overflow = (members ?? []).length - shown.length;

  return (
    <header className={styles.header}>
      <h1 className={styles.heading}>
        <InlineEditable
          className={styles.name}
          // The board name is this button's visible text, so the accessible name has to carry
          // it too (WCAG 2.5.3): a bare "Board name" would make the `h1` announce that literal
          // string instead of the board, because a label on the only child wins the heading's
          // name computation. Same shape as `ListHeader`'s "Rename list <name>".
          label={`Rename board ${board.name}`}
          value={board.name}
          disabled={!canEdit}
          onSave={(name) => updateBoard.mutate({ name })}
        />
      </h1>

      <StarButton boardId={board.id} isStarred={board.is_starred} />

      <Button
        variant="transparent-white"
        icon={current.icon}
        disabled={!canEdit}
        onClick={(event: MouseEvent<HTMLButtonElement>) => setVisibilityAnchor(event.currentTarget)}
      >
        {current.name}
      </Button>

      <span className={styles.divider} aria-hidden="true" />

      <ul className={styles.members}>
        {shown.map((member) => (
          <li key={member.id} className={styles.member}>
            <Avatar name={member.full_name} color={member.avatar_color} size={28} tooltip />
          </li>
        ))}
        {overflow > 0 ? (
          <li className={styles.member}>
            <span className={styles.more}>{`+${overflow}`}</span>
          </li>
        ) : null}
      </ul>

      {board.my_role === 'admin' ? (
        <Button
          variant="transparent-white"
          icon={<UserPlus aria-hidden="true" />}
          onClick={() => setShareOpen(true)}
        >
          Invite
        </Button>
      ) : null}

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

      {shareOpen ? <ShareBoardModal boardId={boardId} onClose={() => setShareOpen(false)} /> : null}

      {boardMenuOpen ? (
        <BoardMenuDrawer
          boardId={boardId}
          onClose={() => setBoardMenuOpen(false)}
          onSearchCards={openFilter}
        />
      ) : null}

      {visibilityAnchor === null ? null : (
        <Popover
          anchor={visibilityAnchor}
          title="Change visibility"
          onClose={() => setVisibilityAnchor(null)}
        >
          {VISIBILITY_ORDER.map((value) => (
            <MenuRow
              key={value}
              icon={VISIBILITIES[value].icon}
              helper={VISIBILITIES[value].description}
              onClick={() => {
                setVisibilityAnchor(null);
                if (value !== board.visibility) updateBoard.mutate({ visibility: value });
              }}
            >
              {VISIBILITIES[value].name}
            </MenuRow>
          ))}
        </Popover>
      )}
    </header>
  );
}
