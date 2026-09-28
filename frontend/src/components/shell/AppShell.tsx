import type { ReactElement } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { KeyboardShortcutsModal, Spinner, ToastViewport } from '@/components/ui';
import { useMe } from '@/hooks/useAuth';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useToast, useToasts } from '@/hooks/useToast';
import { useUiStore } from '@/store/uiStore';
import { TopNav } from './TopNav';
import styles from './AppShell.module.css';

/**
 * The layout every route except `/login` and `/register` renders inside (Section 5.2): it
 * resolves `GET /api/auth/me` once, redirects to `/login?next=<path>` when that comes back
 * 401, and otherwise draws the nav, the routed page and the toast stack.
 *
 * `api/client.ts` also hard-redirects on a 401 from any later call; this guard is what keeps
 * a direct deep link from rendering a page that has no session behind it.
 *
 * It also mounts the `'global'` keyboard scope (`/`, `B`, `?`, `Esc`) and the `?` cheat sheet, so
 * both work on Home, `/w/*` and every other page (Sections 2.8 and 5.9).
 */
export function AppShell(): ReactElement {
  const location = useLocation();
  const { data: user, isPending, isError } = useMe();
  const toasts = useToasts();
  const { dismiss } = useToast();
  const shortcutsOpen = useUiStore((state) => state.shortcutsOpen);
  const setShortcutsOpen = useUiStore((state) => state.setShortcutsOpen);
  useKeyboardShortcuts('global');

  if (isPending) {
    return (
      <div className={styles.booting}>
        <Spinner size={32} label="Loading Kan Ban" />
      </div>
    );
  }

  if (isError || user === undefined) {
    const next = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  return (
    <div className={styles.shell}>
      <TopNav user={user} />
      <Outlet />
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      {shortcutsOpen ? <KeyboardShortcutsModal onClose={() => setShortcutsOpen(false)} /> : null}
    </div>
  );
}
