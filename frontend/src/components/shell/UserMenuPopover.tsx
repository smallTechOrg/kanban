import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Settings } from 'lucide-react';
import type { User } from '@/api/types';
import { Avatar, MenuRow, Popover } from '@/components/ui';
import { useLogout } from '@/hooks/useAuth';
import styles from './UserMenuPopover.module.css';

export interface UserMenuPopoverProps {
  anchor: HTMLElement | DOMRect;
  user: User;
  onClose: () => void;
  /** Closes this popover and opens `ProfileModal`, which the nav owns. */
  onOpenProfile: () => void;
}

/**
 * The avatar menu of Section 2.1.1: "Account" header, the signed-in identity, then
 * "Account settings" and "Log out". Logging out clears the whole query cache (`useLogout`)
 * and lands on `/login`.
 */
export function UserMenuPopover({
  anchor,
  user,
  onClose,
  onOpenProfile,
}: UserMenuPopoverProps): ReactElement {
  const navigate = useNavigate();
  const logout = useLogout();

  // react-query drops a mutation's per-call callbacks when the caller unmounts, so this
  // popover stays open until the logout resolves; the route change then closes it.
  const logOut = (): void => {
    logout.mutate(undefined, {
      onSuccess: () => navigate('/login', { replace: true }),
    });
  };

  return (
    <Popover anchor={anchor} title="Account" onClose={onClose}>
      <div className={styles.identity}>
        <Avatar name={user.full_name} color={user.avatar_color} size={40} />
        <span className={styles.lines}>
          <span className={styles.name}>{user.full_name}</span>
          <span className={styles.email}>{user.email}</span>
        </span>
      </div>
      <hr className={styles.divider} />
      <MenuRow icon={<Settings aria-hidden="true" />} onClick={onOpenProfile}>
        Account settings
      </MenuRow>
      <MenuRow icon={<LogOut aria-hidden="true" />} onClick={logOut}>
        Log out
      </MenuRow>
    </Popover>
  );
}
