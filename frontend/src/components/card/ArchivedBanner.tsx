import type { ReactElement } from 'react';
import { Archive } from 'lucide-react';
import styles from './ArchivedBanner.module.css';

/**
 * The hatched 40px band above an archived card's header (Section 2.6.1): the archive icon and
 * "This card is archived.", nothing else.
 *
 * It states the card's archive state and does not act on it. The two actions an archived card
 * offers — "Send to board" and the confirmed `danger` "Delete" — belong to `CardModalSidebar`,
 * which swaps them in for "Archive" from the same `is_archived` flag (Section 2.6.4); a second
 * pair here would be the same rule, the same confirm body and the same navigate-back written
 * twice (CLAUDE.md section 1, rule 2).
 */
export function ArchivedBanner(): ReactElement {
  return (
    <div className={styles.banner}>
      <Archive className={styles.icon} aria-hidden="true" size={16} />
      <p className={styles.text}>This card is archived.</p>
    </div>
  );
}
