/**
 * The toast queue behind the `Toast` primitive (Section 2.1, last row of the table):
 * bottom-left stack of at most three, each auto-dismissed after 5 seconds, error variant
 * in `--danger-btn`.
 *
 * The queue lives in this module rather than in `store/uiStore.ts` because mutation
 * callbacks in `hooks/*` push to it outside React (`onError` is not a component), and
 * `uiStore` is the store of component-driven UI state. `useSyncExternalStore` keeps the
 * subscribed component in step without a second state library.
 */
import { useSyncExternalStore } from 'react';

export type ToastTone = 'neutral' | 'error';

/**
 * The optional trailing link of an undoable write ("Card archived · Undo", Section 2.10).
 * Declared here rather than imported from `components/ui/Toast.tsx` because hooks never
 * import components (CLAUDE.md section 2); the two shapes are structurally identical and
 * that file says so.
 */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

const AUTO_DISMISS_MS = 5_000;
const MAX_VISIBLE = 3;

let queue: readonly Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly Toast[] {
  return queue;
}

function publish(next: readonly Toast[]): void {
  queue = next;
  for (const listener of listeners) listener();
}

function clearTimer(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
}

function drop(id: number): void {
  clearTimer(id);
  publish(queue.filter((toast) => toast.id !== id));
}

function show(message: string, tone: ToastTone = 'neutral', action?: ToastAction): void {
  const toast: Toast = { id: nextId++, message, tone, action };
  // A fourth toast pushes the oldest out of the stack (Section 2.1: "Stack max 3").
  const overflow = Math.max(0, queue.length + 1 - MAX_VISIBLE);
  for (const stale of queue.slice(0, overflow)) clearTimer(stale.id);
  publish([...queue.slice(overflow), toast]);
  timers.set(
    toast.id,
    setTimeout(() => drop(toast.id), AUTO_DISMISS_MS),
  );
}

export interface ToastApi {
  /**
   * Queues a toast. `'error'` renders the red variant; it dismisses itself after 5 s. An
   * `action` adds the trailing link the archive Undos of Sections 2.4.3 and 2.5.5 need;
   * pressing it dismisses the toast.
   */
  show: (message: string, tone?: ToastTone, action?: ToastAction) => void;
  /** Removes one toast early. `ToastViewport` calls it when a row's own timer fires. */
  dismiss: (id: number) => void;
}

/** Stable across renders, so a mutation hook can hold on to `show` in a callback. */
const TOAST_API: ToastApi = { show, dismiss: drop };

/** The write side: every hook or component that reports something to the user. */
export function useToast(): ToastApi {
  return TOAST_API;
}

/** The read side: `ToastViewport` renders this list. */
export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
