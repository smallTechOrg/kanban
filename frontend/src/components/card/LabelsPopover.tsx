import { useState, type ReactElement } from 'react';
import { Check, Pencil } from 'lucide-react';
import { Button, Checkbox, IconButton, Popover, TextInput, type PopoverNav } from '@/components/ui';
import { LabelChip } from '@/components/ui/LabelChip';
import { useCard, useLabels } from '@/hooks/useBoardData';
import {
  useCreateLabel,
  useDeleteLabel,
  useToggleCardLabel,
  useUpdateLabel,
} from '@/hooks/useCardMutations';
import { useMeta } from '@/hooks/useMeta';
import type { LabelRow } from '@/lib/boardState';
import type { LabelPalette } from '@/lib/colors';
import { useUiStore } from '@/store/uiStore';
import { LabelForm } from './LabelForm';
import { DELETE_LABEL_BODY, NEW_LABEL, draftOf, labelName, type LabelDraft } from './labelDraft';
import styles from './LabelsPopover.module.css';

const NO_LABELS: readonly LabelRow[] = [];
const NO_PALETTE: LabelPalette = {};

interface EditViewOptions {
  nav: PopoverNav;
  palette: LabelPalette;
  patterned: boolean;
  initial: LabelDraft;
  submitLabel: string;
  onSubmit: (draft: LabelDraft) => void;
  onDelete?: () => void;
}

/**
 * One pushed create-or-edit view: the shared `LabelForm` plus this surface's navigation — Save
 * pops back to the list, and Delete pushes the confirm view Section 2.6.5 describes.
 */
function pushLabelForm(title: string, options: EditViewOptions): void {
  const { nav, onSubmit, onDelete, ...form } = options;
  nav.push({
    title,
    content: (
      <LabelForm
        {...form}
        onSubmit={(draft) => {
          onSubmit(draft);
          nav.pop();
        }}
        onDelete={
          onDelete === undefined
            ? undefined
            : () =>
                nav.push({
                  title: 'Delete label?',
                  content: (
                    <div className={styles.panel}>
                      <p className={styles.body}>{DELETE_LABEL_BODY}</p>
                      <Button
                        variant="danger"
                        fullWidth
                        onClick={() => {
                          onDelete();
                          nav.close();
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  ),
                })
        }
      />
    ),
  });
}

export interface LabelsPopoverProps {
  boardId: number;
  cardId: number;
  /** The control the panel hangs off: a sidebar row, the quick editor, or the badge row's "+". */
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
}

/**
 * "Labels" (Section 2.6.5): the board's palette as toggle rows, the search box that filters
 * them, the colourblind-friendly switch, and the create / edit / delete sub-views pushed onto
 * the `Popover` view stack.
 *
 * The card's own labels are read from the board cache, so the panel opens with no request of its
 * own whether it was opened from the modal or from a tile; both toggle endpoints answer with the
 * card's whole `label_ids` array, which `useToggleCardLabel` writes into the board payload and
 * the card detail at once (Section 4.5).
 */
export function LabelsPopover({
  boardId,
  cardId,
  anchor,
  onClose,
}: LabelsPopoverProps): ReactElement {
  const [query, setQuery] = useState('');
  const labels = useLabels(boardId).data ?? NO_LABELS;
  const card = useCard(boardId, cardId).data;
  const palette: LabelPalette = useMeta().data?.label_colors ?? NO_PALETTE;
  const patterned = useUiStore((state) => state.colorBlindLabels);
  const setColorBlindLabels = useUiStore((state) => state.setColorBlindLabels);

  const toggleLabel = useToggleCardLabel(boardId, cardId);
  const createLabel = useCreateLabel(boardId, cardId);
  const updateLabel = useUpdateLabel(boardId, cardId);
  const deleteLabel = useDeleteLabel(boardId, cardId);

  const attached = new Set(card?.label_ids ?? []);
  const needle = query.trim().toLowerCase();
  // An unnamed label is shown by its colour key, so that is what the search matches on.
  const visible = labels.filter((label) => labelName(label).toLowerCase().includes(needle));

  return (
    <Popover anchor={anchor} title="Labels" onClose={onClose}>
      {(nav) => (
        <div className={styles.panel}>
          <TextInput
            placeholder="Search labels…"
            aria-label="Search labels"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          <p className={styles.subheading}>Labels</p>
          <ul className={styles.rows}>
            {visible.map((label) => {
              const isOn = attached.has(label.id);
              return (
                <li key={label.id} className={styles.row}>
                  <LabelChip
                    size="large"
                    className={styles.chip}
                    name={label.name}
                    color={label.color}
                    tone={label.tone}
                    palette={palette}
                    patterned={patterned}
                    pressed={isOn}
                    onClick={() => toggleLabel.mutate({ labelId: label.id, attached: !isOn })}
                  >
                    {isOn ? <Check className={styles.check} aria-hidden="true" /> : null}
                  </LabelChip>
                  <IconButton
                    size="sm"
                    label={`Edit label ${labelName(label)}`}
                    onClick={() =>
                      pushLabelForm('Edit label', {
                        nav,
                        palette,
                        patterned,
                        initial: draftOf(label),
                        submitLabel: 'Save',
                        onSubmit: (draft) => updateLabel.mutate({ labelId: label.id, ...draft }),
                        onDelete: () => deleteLabel.mutate(label.id),
                      })
                    }
                  >
                    <Pencil aria-hidden="true" />
                  </IconButton>
                </li>
              );
            })}
          </ul>

          <Button
            fullWidth
            onClick={() =>
              pushLabelForm('Create label', {
                nav,
                palette,
                patterned,
                initial: NEW_LABEL,
                submitLabel: 'Create',
                onSubmit: (draft) => createLabel.mutate(draft),
              })
            }
          >
            Create a new label
          </Button>

          <div className={styles.divider} />
          <Checkbox
            label="Enable colorblind friendly mode"
            checked={patterned}
            onChange={(event) => setColorBlindLabels(event.target.checked)}
          />
        </div>
      )}
    </Popover>
  );
}
