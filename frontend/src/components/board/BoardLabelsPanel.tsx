import { useRef, useState, type ReactElement } from 'react';
import { Pencil } from 'lucide-react';
import { Button, ConfirmPopover, IconButton } from '@/components/ui';
import { LabelChip } from '@/components/ui/LabelChip';
import { LabelForm } from '@/components/card/LabelForm';
import {
  DELETE_LABEL_BODY,
  NEW_LABEL,
  draftOf,
  labelName,
  type LabelDraft,
} from '@/components/card/labelDraft';
import { useLabels } from '@/hooks/useBoardData';
import { useCreateLabel, useDeleteLabel, useUpdateLabel } from '@/hooks/useCardMutations';
import { useMeta } from '@/hooks/useMeta';
import type { LabelRow } from '@/lib/boardState';
import type { LabelPalette } from '@/lib/colors';
import { useUiStore } from '@/store/uiStore';
import styles from './BoardLabelsPanel.module.css';

const NO_LABELS: readonly LabelRow[] = [];
const NO_PALETTE: LabelPalette = {};

/**
 * The label mutations keep `['card', cardId]` in step for the modal that opened them; the drawer
 * has no open card, so only their board half applies (Section 5.4.3).
 */
const NO_CARD = 0;

/** Which body the panel shows: the list, a new label, or one being edited. */
type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; label: LabelRow };

export interface BoardLabelsPanelProps {
  boardId: number;
}

/**
 * The board menu's "Labels" sub-panel (Section 2.3.4): the board's labels as the same rows
 * `LabelsPopover` lists, and "Create a new label".
 *
 * Nothing here toggles a label — there is no card to toggle it on — so a row is the chip plus the
 * pencil that opens `LabelForm`, the very form the card modal pushes, and the create, rename,
 * recolour and delete writes are the same four hooks (CLAUDE.md section 3).
 */
export function BoardLabelsPanel({ boardId }: BoardLabelsPanelProps): ReactElement {
  const labels = useLabels(boardId).data ?? NO_LABELS;
  const palette: LabelPalette = useMeta().data?.label_colors ?? NO_PALETTE;
  const patterned = useUiStore((state) => state.colorBlindLabels);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [confirmAnchor, setConfirmAnchor] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const createLabel = useCreateLabel(boardId, NO_CARD);
  const updateLabel = useUpdateLabel(boardId, NO_CARD);
  const deleteLabel = useDeleteLabel(boardId, NO_CARD);

  function save(draft: LabelDraft): void {
    if (view.kind === 'edit') updateLabel.mutate({ labelId: view.label.id, ...draft });
    else createLabel.mutate(draft);
    setView({ kind: 'list' });
  }

  return (
    <div className={styles.panel} ref={rootRef}>
      {view.kind === 'list' ? (
        <>
          <ul className={styles.rows}>
            {labels.map((label) => (
              <li key={label.id} className={styles.row}>
                <LabelChip
                  size="large"
                  className={styles.chip}
                  name={label.name}
                  color={label.color}
                  tone={label.tone}
                  palette={palette}
                  patterned={patterned}
                />
                <IconButton
                  size="sm"
                  label={`Edit label ${labelName(label)}`}
                  onClick={() => setView({ kind: 'edit', label })}
                >
                  <Pencil aria-hidden="true" />
                </IconButton>
              </li>
            ))}
          </ul>
          <Button fullWidth onClick={() => setView({ kind: 'create' })}>
            Create a new label
          </Button>
        </>
      ) : (
        <>
          <LabelForm
            palette={palette}
            patterned={patterned}
            initial={view.kind === 'edit' ? draftOf(view.label) : NEW_LABEL}
            submitLabel={view.kind === 'edit' ? 'Save' : 'Create'}
            onSubmit={save}
            onDelete={view.kind === 'edit' ? () => setConfirmAnchor(rootRef.current) : undefined}
          />
          <Button variant="link" fullWidth onClick={() => setView({ kind: 'list' })}>
            Cancel
          </Button>
        </>
      )}

      {confirmAnchor === null || view.kind !== 'edit' ? null : (
        <ConfirmPopover
          anchor={confirmAnchor}
          title="Delete label?"
          body={DELETE_LABEL_BODY}
          onClose={() => setConfirmAnchor(null)}
          onConfirm={() => {
            deleteLabel.mutate(view.label.id);
            setConfirmAnchor(null);
            setView({ kind: 'list' });
          }}
        />
      )}
    </div>
  );
}
