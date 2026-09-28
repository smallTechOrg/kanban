import { useEffect, type ReactElement } from 'react';
import { cx } from './classNames';
import styles from './Toast.module.css';

/**
 * Error toasts are red (Section 2.10 "Mutation failure"). The name and the member names match
 * `hooks/useToast.ts`, which owns the queue: its `Toast` rows are rendered by this component,
 * so the two shapes must not drift.
 */
export type ToastTone = 'neutral' | 'error';

/** The optional trailing link, e.g. "Undo" on an archive toast (Section 2.10). */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: number;
  message: string;
  tone?: ToastTone;
  action?: ToastAction;
}

/** Auto-dismiss delay from Section 2.1.2. */
export const TOAST_DURATION_MS = 5000;

export interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}

/** One toast row. The stack and its state live in `ToastViewport` and the `useToast` hook. */
export function Toast({ toast, onDismiss }: ToastProps): ReactElement {
  const { id, message, tone = 'neutral', action } = toast;

  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(id), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [id, onDismiss]);

  return (
    <div
      className={cx(styles.toast, tone === 'error' && styles.error)}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span className={styles.message}>{message}</span>
      {action === undefined ? null : (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            action.onClick();
            onDismiss(id);
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
