import type { ReactElement } from 'react';
import { Outlet } from 'react-router-dom';
import { KeyboardShortcutsModal, ToastViewport } from '@/components/ui';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useToast, useToasts } from '@/hooks/useToast';
import { useUiStore } from '@/store/uiStore';
import { TopNav } from './TopNav';
import styles from './AppShell.module.css';

/**
 * The layout every route renders inside (Section 5.2): the nav, the routed page and the
 * toast stack.
 *
 * It also mounts the `'global'` keyboard scope (`/`, `B`, `?`, `Esc`) and the `?` cheat sheet, so
 * both work on Home and every other page (Sections 2.8 and 5.9).
 */
export function AppShell(): ReactElement {
  const toasts = useToasts();
  const { dismiss } = useToast();
  const shortcutsOpen = useUiStore((state) => state.shortcutsOpen);
  const setShortcutsOpen = useUiStore((state) => state.setShortcutsOpen);
  useKeyboardShortcuts('global');

  return (
    <div className={styles.shell}>
      <TopNav />
      <Outlet />
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      {shortcutsOpen ? <KeyboardShortcutsModal onClose={() => setShortcutsOpen(false)} /> : null}
    </div>
  );
}
