import type { ReactElement } from 'react';
import { Toast, type ToastItem } from './Toast';
import styles from './ToastViewport.module.css';

/** Section 2.1.2: the stack shows at most three toasts. */
export const MAX_VISIBLE_TOASTS = 3;

export interface ToastViewportProps {
  toasts: readonly ToastItem[];
  onDismiss: (id: number) => void;
}

/**
 * The bottom-left stack, mounted once by `AppShell`. It is presentational: the queue and the
 * `show`/`dismiss` API live in the `useToast` hook, which passes them in.
 */
export function ToastViewport({ toasts, onDismiss }: ToastViewportProps): ReactElement | null {
  if (toasts.length === 0) return null;
  const visible = toasts.slice(-MAX_VISIBLE_TOASTS);

  return (
    <div className={styles.viewport}>
      {visible.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
