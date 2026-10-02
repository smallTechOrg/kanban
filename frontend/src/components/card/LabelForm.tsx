import { useId, useState, type ReactElement } from 'react';
import { X } from 'lucide-react';
import type { LabelColorKey, LabelTone } from '@/api/types';
import { Button, Field, TextInput, cx } from '@/components/ui';
import { LabelChip } from '@/components/ui/LabelChip';
import { FALLBACK_LABEL_KEY, labelStyle, type LabelPalette } from '@/lib/colors';
import type { LabelDraft } from './labelDraft';
import styles from './LabelForm.module.css';

/** The three rows of the swatch grid, in the order Section 2.6.5 lists them. */
const TONES: readonly LabelTone[] = ['subtle', 'normal', 'bold'];

export interface LabelFormProps {
  palette: LabelPalette;
  /** `uiStore.colorBlindLabels`, so the preview chip wears the same stripes as the board. */
  patterned: boolean;
  initial: LabelDraft;
  /** "Create" or "Save" (Section 2.6.5). */
  submitLabel: string;
  onSubmit: (draft: LabelDraft) => void;
  /** Absent on a create view, and on an edit view a non-admin opened (Section 2.6.5). */
  onDelete?: () => void;
}

/**
 * The "Create label" / "Edit label" view of Section 2.6.5: the preview chip, the title, the
 * tri-tone swatch grid and "Remove color".
 *
 * It owns its draft, which is what makes it usable inside `Popover`'s view stack: that stack
 * captures a pushed view's content when `nav.push` runs, so a form built from its parent's state
 * would keep rendering the values that existed at that moment and the preview would never follow
 * the swatch just picked. Navigation and confirmation belong to the caller — `LabelsPopover`
 * pushes and pops views, the board menu's Labels panel swaps its own body — so the same form
 * serves both without either one holding a second copy of the swatch grid (CLAUDE.md section 3).
 */
export function LabelForm({
  palette,
  patterned,
  initial,
  submitLabel,
  onSubmit,
  onDelete,
}: LabelFormProps): ReactElement {
  const [draft, setDraft] = useState<LabelDraft>(initial);
  const gridId = useId();
  // The palette is the server's (Section 2.9.2), so the ten keys and their order are not
  // written down here; `none` is reached through "Remove color" instead of a swatch.
  const keys = Object.keys(palette).filter((key) => key !== FALLBACK_LABEL_KEY);

  return (
    <div className={styles.form}>
      <div className={styles.preview}>
        <LabelChip
          size="large"
          name={draft.name}
          color={draft.color}
          tone={draft.tone}
          palette={palette}
          patterned={patterned}
        />
      </div>

      <Field label="Title">
        {(control) => (
          <TextInput
            {...control}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        )}
      </Field>

      <p className={styles.subheading} id={gridId}>
        Select a color
      </p>
      <div className={styles.grid} role="group" aria-labelledby={gridId}>
        {TONES.map((tone) =>
          keys.map((key) => {
            const selected = draft.color === key && draft.tone === tone;
            return (
              <button
                key={`${tone}-${key}`}
                type="button"
                className={cx(styles.swatch, selected && styles.swatchSelected)}
                // The hex is a runtime value from GET /api/meta, which is the one inline-style
                // exception of CLAUDE.md section 5.
                style={{ background: labelStyle(key, tone, palette).background }}
                aria-label={`${key} ${tone}`}
                aria-pressed={selected}
                // `labels.color` is one of the keys this palette publishes, which is exactly
                // the ten of `LabelColorKey` (Section 4.3, CLAUDE.md section 3).
                onClick={() => setDraft({ ...draft, color: key as LabelColorKey, tone })}
              />
            );
          }),
        )}
      </div>

      <Button
        fullWidth
        icon={<X aria-hidden="true" />}
        onClick={() => setDraft({ ...draft, color: FALLBACK_LABEL_KEY })}
      >
        Remove color
      </Button>
      <Button variant="primary" fullWidth onClick={() => onSubmit(draft)}>
        {submitLabel}
      </Button>
      {onDelete === undefined ? null : (
        <Button variant="danger" fullWidth onClick={onDelete}>
          Delete
        </Button>
      )}
    </div>
  );
}
