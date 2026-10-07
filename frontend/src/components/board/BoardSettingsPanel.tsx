import type { ReactElement } from 'react';
import { Checkbox } from '@/components/ui';
import { useUiStore } from '@/store/uiStore';
import styles from './BoardSettingsPanel.module.css';

/**
 * The board menu's "Settings" sub-panel (Section 2.3.4): the colour-blind label toggle.
 *
 * The toggle is `uiStore.colorBlindLabels`, which every `LabelChip` already reads and which
 * persists as `localStorage.kb_colorBlindLabels` (Section 5.13) — so it is app-wide state rather
 * than a board field, and the panel needs no board to render. It is the one setting left: card
 * covers are gone, so the toggle that switched them off went with them.
 */
export function BoardSettingsPanel(): ReactElement {
  const colorBlindLabels = useUiStore((state) => state.colorBlindLabels);
  const setColorBlindLabels = useUiStore((state) => state.setColorBlindLabels);

  return (
    <div className={styles.panel}>
      <Checkbox
        label="Color blind friendly mode"
        checked={colorBlindLabels}
        onChange={(event) => setColorBlindLabels(event.target.checked)}
      />
    </div>
  );
}
