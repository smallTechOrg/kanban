import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button } from './Button';
import { Popover } from './Popover';
import { Textarea } from './Textarea';
import styles from './MarkdownEditor.module.css';

/** Section 5.7: the six GFM rows the "Formatting help" popover lists. */
const CHEAT_SHEET: readonly { syntax: string; effect: string }[] = [
  { syntax: '**bold**', effect: 'Bold' },
  { syntax: '*italic*', effect: 'Italic' },
  { syntax: '[title](https://…)', effect: 'Link' },
  { syntax: '`code`', effect: 'Inline code' },
  { syntax: '- item', effect: 'Bullet list' },
  { syntax: '- [ ] item', effect: 'Task list' },
];

export interface MarkdownEditorProps {
  /** Controlled, so the caller owns the draft and can keep it across a collapse. */
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  onCancel: () => void;
  /** Accessible name of the textarea, e.g. "Description" or "Space description". */
  label: string;
  placeholder?: string;
  minRows?: number;
}

/**
 * The plain-textarea Markdown editor of Section 5.7 — no WYSIWYG: a `Textarea` that grows,
 * `Ctrl/Cmd+Enter` to save, `Escape` to cancel, `primary` Save, `default` Cancel and a `link`
 * "Formatting help" opening the GFM cheat sheet.
 *
 * `Textarea` owns that keyboard contract, so Escape also never reaches the dialog behind this
 * editor: it stops the event, which is what makes "Esc closes the topmost editor first, then the
 * modal" true in `CardDetailModal` without either component knowing about the other
 * (Sections 2.6.1 and 2.6.5).
 */
export function MarkdownEditor({
  value,
  onChange,
  onSave,
  onCancel,
  label,
  placeholder,
  minRows = 3,
}: MarkdownEditorProps): ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [help, setHelp] = useState<HTMLElement | null>(null);

  // Opening the editor is always a decision to type, so the caret goes there — and `autoFocus`
  // is banned by the lint rules, which is why this is an effect (Section 5.10).
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className={styles.editor}>
      <Textarea
        ref={ref}
        className={styles.input}
        aria-label={label}
        placeholder={placeholder}
        minRows={minRows}
        value={value}
        submitKey="mod-enter"
        onChange={(event) => onChange(event.target.value)}
        onSubmit={onSave}
        onCancel={onCancel}
      />

      <div className={styles.footer}>
        <Button variant="primary" onClick={onSave}>
          Save
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="link"
          className={styles.help}
          onClick={(event) => setHelp(event.currentTarget)}
        >
          Formatting help
        </Button>
      </div>

      {help === null ? null : (
        <Popover anchor={help} title="Formatting help" onClose={() => setHelp(null)}>
          <dl className={styles.cheatSheet}>
            {CHEAT_SHEET.map((row) => (
              <div key={row.syntax} className={styles.cheatRow}>
                <dt className={styles.cheatEffect}>{row.effect}</dt>
                <dd className={styles.cheatSyntax}>{row.syntax}</dd>
              </div>
            ))}
          </dl>
        </Popover>
      )}
    </div>
  );
}
