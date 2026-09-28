import { forwardRef, type KeyboardEvent } from 'react';
import TextareaAutosize, { type TextareaAutosizeProps } from 'react-textarea-autosize';
import { cx } from './classNames';
import styles from './Textarea.module.css';

/** Which Enter combination submits. Shift+Enter always inserts a newline. */
export type SubmitKey = 'enter' | 'mod-enter';

export interface TextareaProps extends Omit<TextareaAutosizeProps, 'onSubmit' | 'style'> {
  /** Called by the submit key. Without it the textarea is a plain autosizing field. */
  onSubmit?: () => void;
  /** Called by Escape. */
  onCancel?: () => void;
  submitKey?: SubmitKey;
}

/**
 * `react-textarea-autosize` with the keyboard contract the composers and inline editors
 * share (Sections 2.4.2 and 5.7): Enter (or Ctrl/Cmd+Enter) submits, Shift+Enter adds a
 * newline, Escape cancels.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { onSubmit, onCancel, submitKey = 'enter', onKeyDown, className, ...rest },
  ref,
) {
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    if (event.key === 'Escape' && onCancel !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== 'Enter' || onSubmit === undefined || event.shiftKey) return;

    const withModifier = event.metaKey || event.ctrlKey;
    if (submitKey === 'mod-enter' ? withModifier : !withModifier) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <TextareaAutosize
      ref={ref}
      className={cx(styles.textarea, className)}
      onKeyDown={handleKeyDown}
      {...rest}
    />
  );
});
