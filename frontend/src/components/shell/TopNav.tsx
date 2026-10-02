import { useEffect, type MouseEvent, type ReactElement } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutGrid, Plus } from 'lucide-react';
import { Button, IconButton, MenuRow, Popover, cx } from '@/components/ui';
import { SHORTCUT_ANCHOR_ATTR } from '@/hooks/useKeyboardShortcuts';
import { useUiStore, type PopoverKind } from '@/store/uiStore';
import { BoardsPopover } from './BoardsPopover';
import { CreateMenuPopover } from './CreateMenuPopover';
import { SearchPopover } from './SearchPopover';
import styles from './TopNav.module.css';

/**
 * The 44px bar of Section 2.1.1: grid button, wordmark, Boards, the Create menu and the
 * search shell.
 *
 * There is no Recent or Starred dropdown: one person's boards are one list, so "Boards" goes
 * home and the `B` shortcut opens `BoardsPopover` on that same button.
 *
 * Which popover is open lives in `uiStore.openPopover`, the single field that keeps exactly
 * one popover open across the whole app (Section 2.1.2).
 */
export function TopNav(): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const popover = useUiStore((state) => state.openPopover);
  const setOpenPopover = useUiStore((state) => state.setOpenPopover);

  // Section 2.1.2: a popover closes on a route change.
  useEffect(() => {
    setOpenPopover(null);
  }, [location.pathname, setOpenPopover]);

  const close = (): void => setOpenPopover(null);

  const openFrom =
    (kind: PopoverKind, props?: Record<string, unknown>) =>
    (event: MouseEvent<HTMLElement>): void => {
      setOpenPopover({ kind, anchor: event.currentTarget, props });
    };

  // On a board the nav darkens the board background instead of painting itself (2.1.1).
  const onBoard = location.pathname.startsWith('/b/');

  return (
    <header className={cx(styles.nav, onBoard && styles.onBoard)}>
      <div className={styles.group}>
        <IconButton label="Switch to" tone="white" onClick={openFrom('switchTo')}>
          <LayoutGrid aria-hidden="true" />
        </IconButton>

        <Link to="/" className={styles.wordmark} aria-label="My Day">
          <span className={styles.mark} aria-hidden="true">
            <span className={styles.bar} />
            <span className={styles.bar} />
            <span className={styles.bar} />
          </span>
          <span className={styles.wordmarkText}>My Day</span>
        </Link>

        <Button
          variant="transparent-white"
          className={styles.navButton}
          // The `B` shortcut has no click to read an anchor from, so it opens `BoardsPopover`
          // on this button, the one control that is on screen at every width (Section 2.8).
          {...{ [SHORTCUT_ANCHOR_ATTR]: 'boards' }}
          onClick={() => navigate('/')}
        >
          Boards
        </Button>

        <Button
          variant="transparent-white"
          className={styles.navButton}
          icon={<Plus className={styles.chevron} aria-hidden="true" />}
          onClick={openFrom('createMenu')}
        >
          Create
        </Button>
      </div>

      <div className={styles.group}>
        <SearchPopover />
      </div>

      {popover?.kind === 'switchTo' ? (
        <Popover anchor={popover.anchor} title="Switch to" onClose={close}>
          <MenuRow
            icon={<LayoutGrid aria-hidden="true" />}
            onClick={() => {
              close();
              navigate('/');
            }}
          >
            Boards
          </MenuRow>
        </Popover>
      ) : null}

      {popover?.kind === 'boards' ? (
        <BoardsPopover anchor={popover.anchor} onClose={close} />
      ) : null}

      {popover?.kind === 'createMenu' ? (
        <CreateMenuPopover anchor={popover.anchor} onClose={close} />
      ) : null}
    </header>
  );
}
