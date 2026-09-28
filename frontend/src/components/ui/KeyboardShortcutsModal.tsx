import type { ReactElement } from 'react';
import { board, global, type Shortcut, type ShortcutGroup } from '@/lib/shortcuts';
import { Kbd } from './Kbd';
import { Modal } from './Modal';
import styles from './KeyboardShortcutsModal.module.css';

export interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

/** Section 2.8's groups, in the order the sheet prints them. */
const GROUPS: readonly ShortcutGroup[] = [
  'Global',
  'Board',
  'Card',
  'Editors',
  'Drag with the keyboard',
];

/** Both tables, so a row can only reach the sheet if the handler dispatches it. */
const ROWS: readonly Shortcut[] = [...global, ...board];

/** A chip that only ever appears as the first half of a combination. */
const MODIFIERS: readonly string[] = ['Ctrl', 'Shift'];

/** How one row's chips read together: `Ctrl + Enter`, `,` or `<`, or a plain list. */
function separatorOf(row: Shortcut): string | null {
  if (MODIFIERS.includes(row.chips[0] ?? '')) return '+';
  return row.keys.length > 1 ? null : ' ';
}

/** One row's `<Kbd>` chips with that separator between them. */
function chips(row: Shortcut): ReactElement {
  const separator = separatorOf(row);
  return (
    <span className={styles.keys}>
      {row.chips.map((chip, index) => (
        <span key={chip} className={styles.chip}>
          {index === 0 ? null : separator === null ? (
            <span className={styles.or}>or</span>
          ) : (
            <span className={styles.or}>{separator}</span>
          )}
          <Kbd>{chip}</Kbd>
        </span>
      ))}
    </span>
  );
}

/**
 * The `?` cheat sheet (Sections 2.8 and 5.9): a 768px modal titled "Keyboard shortcuts" whose
 * two columns are generated from `lib/shortcuts.ts`, the same two tables the handler dispatches,
 * so the sheet cannot drift from the app. Its last group describes dragging with the keyboard,
 * which the DnD library owns rather than the shortcut map.
 */
export function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps): ReactElement {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <div className={styles.columns}>
        {GROUPS.map((group) => {
          const rows = ROWS.filter((row) => row.group === group);
          return (
            <section key={group} className={styles.group}>
              <h3 className={styles.heading}>{group}</h3>
              <dl className={styles.list}>
                {rows.map((row) => (
                  <div key={row.description} className={styles.row}>
                    <dt className={styles.term}>{chips(row)}</dt>
                    <dd className={styles.definition}>{row.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
