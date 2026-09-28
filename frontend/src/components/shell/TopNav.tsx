import { useEffect, useState, type MouseEvent, type ReactElement } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, LayoutGrid, Plus } from 'lucide-react';
import type { User } from '@/api/types';
import { Avatar, Button, IconButton, MenuRow, Popover, cx } from '@/components/ui';
import { SHORTCUT_ANCHOR_ATTR } from '@/hooks/useKeyboardShortcuts';
import { useUiStore, type PopoverKind } from '@/store/uiStore';
import { BoardsPopover, type BoardsGroup } from './BoardsPopover';
import { CreateMenuPopover } from './CreateMenuPopover';
import { ProfileModal } from './ProfileModal';
import { SearchPopover } from './SearchPopover';
import { UserMenuPopover } from './UserMenuPopover';
import styles from './TopNav.module.css';

export interface TopNavProps {
  user: User;
}

/**
 * Recent, Starred and the `B` shortcut share one popover; `openPopover.props` says which list to
 * show — one of the two, or both at once for the key (Section 2.8).
 */
function boardsGroupOf(props: Record<string, unknown> | undefined): BoardsGroup {
  const group = props?.['group'];
  if (group === 'starred') return 'starred';
  if (group === 'both') return 'both';
  return 'recent';
}

/**
 * The 44px bar of Section 2.1.1: grid button, wordmark, Boards, Recent and Starred, the
 * Create menu, the search shell, the notifications placeholder and the user menu.
 *
 * Which popover is open lives in `uiStore.openPopover`, the single field that keeps exactly
 * one popover open across the whole app (Section 2.1.2).
 */
export function TopNav({ user }: TopNavProps): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const popover = useUiStore((state) => state.openPopover);
  const setOpenPopover = useUiStore((state) => state.setOpenPopover);
  const [profileOpen, setProfileOpen] = useState(false);

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

        <Link to="/" className={styles.wordmark} aria-label="Kan Ban">
          <span className={styles.mark} aria-hidden="true">
            <span className={styles.bar} />
            <span className={styles.bar} />
            <span className={styles.bar} />
          </span>
          <span className={styles.wordmarkText}>Kan Ban</span>
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
          className={cx(styles.navButton, styles.wideOnly)}
          onClick={openFrom('boards', { group: 'recent' })}
        >
          Recent
          <ChevronDown className={styles.chevron} aria-hidden="true" />
        </Button>

        <Button
          variant="transparent-white"
          className={cx(styles.navButton, styles.wideOnly)}
          onClick={openFrom('boards', { group: 'starred' })}
        >
          Starred
          <ChevronDown className={styles.chevron} aria-hidden="true" />
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

        <IconButton
          label="Notifications"
          tone="white"
          tooltip="Notifications are not available yet"
          disabled
        >
          <Bell aria-hidden="true" />
        </IconButton>

        <button
          type="button"
          className={styles.avatarButton}
          aria-label="Account menu"
          onClick={openFrom('userMenu')}
        >
          <Avatar name={user.full_name} color={user.avatar_color} size={28} />
        </button>
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
        <BoardsPopover
          anchor={popover.anchor}
          group={boardsGroupOf(popover.props)}
          onClose={close}
        />
      ) : null}

      {popover?.kind === 'createMenu' ? (
        <CreateMenuPopover anchor={popover.anchor} onClose={close} />
      ) : null}

      {popover?.kind === 'userMenu' ? (
        <UserMenuPopover
          anchor={popover.anchor}
          user={user}
          onClose={close}
          onOpenProfile={() => {
            close();
            setProfileOpen(true);
          }}
        />
      ) : null}

      {profileOpen ? <ProfileModal user={user} onClose={() => setProfileOpen(false)} /> : null}
    </header>
  );
}
