import { useEffect, useRef, useState, type ReactElement } from 'react';
import { cx } from './classNames';
import { Textarea } from './Textarea';
import styles from './InlineEditable.module.css';

export interface InlineEditableProps {
  value: string;
  /** Called with the trimmed text when it actually changed. */
  onSave: (next: string) => void;
  /** Accessible name for both the trigger and the textarea. */
  label: string;
  placeholder?: string;
  /** Applied to the display and the editor so the caller's typography carries over. */
  className?: string;
  /** Observers see the text but cannot edit it. */
  disabled?: boolean;
}

/**
 * Click-to-edit text (Section 5.3): Enter or blur commits, Escape reverts, and the editor
 * wears the 2px `--focus` inset ring. An empty or unchanged value is discarded, so a title
 * can never be blanked by accident.
 */
export function InlineEditable({
  value,
  onSave,
  label,
  placeholder,
  className,
  disabled = false,
}: InlineEditableProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  const restoreFocus = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (editing) {
      const input = inputRef.current;
      if (input === null) return;
      input.focus();
      input.select();
      return;
    }
    // Keyboard commits hand focus back to the trigger; a blur must leave it where the
    // pointer put it. The trigger only exists after this render, hence the effect.
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    triggerRef.current?.focus();
  }, [editing]);

  function startEditing(): void {
    cancelled.current = false;
    setDraft(value);
    setEditing(true);
  }

  function stopEditing(returnFocus: boolean): void {
    restoreFocus.current = returnFocus;
    setEditing(false);
  }

  function commit(returnFocus: boolean): void {
    if (cancelled.current) return;
    const next = draft.trim();
    if (next !== '' && next !== value) onSave(next);
    stopEditing(returnFocus);
  }

  function cancel(): void {
    cancelled.current = true;
    setDraft(value);
    stopEditing(true);
  }

  if (editing) {
    return (
      <Textarea
        ref={inputRef}
        className={cx(styles.input, className)}
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onSubmit={() => commit(true)}
        onCancel={cancel}
        onBlur={() => commit(false)}
        // `ListHeader` puts this editor inside the list's drag handle, whose `Draggable` turns
        // the library's interactive-element blocking off (`board/BoardDndContext.tsx`). The
        // drag sensor listens on `window` and `preventDefault`s the mousedown it claims, which
        // would stop a click from moving the caret and let a 5px drag inside the editor lift
        // the whole column. Stopping the event here keeps the editor a plain textarea.
        onMouseDown={(event) => event.stopPropagation()}
      />
    );
  }

  return (
    <button
      type="button"
      ref={triggerRef}
      className={cx(styles.display, value === '' && styles.placeholder, className)}
      aria-label={label}
      disabled={disabled}
      onClick={startEditing}
    >
      {value === '' ? placeholder : value}
    </button>
  );
}
