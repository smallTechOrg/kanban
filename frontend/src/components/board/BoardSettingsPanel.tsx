import type { ReactElement } from 'react';
import { Checkbox } from '@/components/ui';
import { useUiStore } from '@/store/uiStore';
import styles from './BoardSettingsPanel.module.css';

/**
 * The board menu's "Settings" sub-panel (Section 2.3.4): the "Card covers enabled" toggle.
 *
 * The toggle is `uiStore.cardCoversEnabled`, which `CardTile` already reads and which persists as
 * `localStorage.kb_cardCovers` (Section 5.13) — so it is app-wide state rather than a board field,
 * and the panel needs no board to render.
 */
export function BoardSettingsPanel(): ReactElement {
  const coversEnabled = useUiStore((state) => state.cardCoversEnabled);
  const setCardCoversEnabled = useUiStore((state) => state.setCardCoversEnabled);

  return (
    <div className={styles.panel}>
      <Checkbox
        label="Card covers enabled"
        checked={coversEnabled}
        onChange={(event) => setCardCoversEnabled(event.target.checked)}
      />
    </div>
  );
}
