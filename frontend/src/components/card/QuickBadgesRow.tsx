import { useState, type ReactElement } from 'react';
import { Plus } from 'lucide-react';
import { Button, cx } from '@/components/ui';
import { LabelChip } from '@/components/ui/LabelChip';
import { useLabels } from '@/hooks/useBoardData';
import { useUpdateCardFields } from '@/hooks/useCardMutations';
import { useMeta } from '@/hooks/useMeta';
import type { CardDetail } from '@/api/types';
import { dueState, type DueState } from '@/lib/badges';
import type { LabelRow } from '@/lib/boardState';
import type { LabelPalette } from '@/lib/colors';
import { formatDate, formatDateTime } from '@/lib/dates';
import { useUiStore } from '@/store/uiStore';
import { DatesPopover } from './DatesPopover';
import { LabelsPopover } from './LabelsPopover';
import styles from './QuickBadgesRow.module.css';

const NO_LABELS: readonly LabelRow[] = [];
const NO_PALETTE: LabelPalette = {};

/** Section 2.6.3: the pill after the Dates button, or nothing in the default state. */
const PILL_TEXT: Record<DueState, string | null> = {
  none: null,
  soon: 'due soon',
  overdue: 'overdue',
  complete: 'complete',
};

const PILL_CLASS: Record<DueState, string | undefined> = {
  none: undefined,
  soon: styles.soon,
  overdue: styles.overdue,
  complete: styles.complete,
};

export interface QuickBadgesRowProps {
  boardId: number;
  card: CardDetail;
}

/**
 * The quick badges row of Section 2.6.3: the groups that show what the card already carries,
 * each with a 12px label and each rendered only when it has data — so an empty card shows
 * nothing here and every one of these values is added from the sidebar instead.
 */
export function QuickBadgesRow({ boardId, card }: QuickBadgesRowProps): ReactElement {
  const [labelsAnchor, setLabelsAnchor] = useState<HTMLElement | null>(null);
  const [datesAnchor, setDatesAnchor] = useState<HTMLElement | null>(null);
  const labels = useLabels(boardId).data ?? NO_LABELS;
  const palette: LabelPalette = useMeta().data?.label_colors ?? NO_PALETTE;
  const colorBlind = useUiStore((state) => state.colorBlindLabels);
  const update = useUpdateCardFields(boardId, card.id);

  const chips = card.label_ids
    .map((labelId) => labels.find((label) => label.id === labelId))
    .filter((label): label is LabelRow => label !== undefined);

  const hasDates = card.start_at !== null || card.due_at !== null;
  const state = dueState(card, new Date());
  const pill = PILL_TEXT[state];

  return (
    <div className={styles.row}>
      {chips.length === 0 ? null : (
        <div className={styles.group}>
          <span className={styles.label} id="card-labels-label">
            Labels
          </span>
          <div className={styles.values} aria-labelledby="card-labels-label">
            {chips.map((label) => (
              <LabelChip
                key={label.id}
                name={label.name}
                color={label.color}
                tone={label.tone}
                palette={palette}
                patterned={colorBlind}
                size="large"
              />
            ))}
            <button
              type="button"
              className={styles.add}
              aria-label="Edit labels"
              onClick={(event) => setLabelsAnchor(event.currentTarget)}
            >
              <Plus aria-hidden="true" size={16} />
            </button>
          </div>
        </div>
      )}

      {!hasDates ? null : (
        <div className={styles.group}>
          <span className={styles.label} id="card-dates-label">
            Dates
          </span>
          <div className={styles.values} aria-labelledby="card-dates-label">
            {card.due_at === null ? null : (
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={card.due_complete}
                aria-label="Mark the due date complete"
                onChange={(event) => update.mutate({ due_complete: event.target.checked })}
              />
            )}
            <Button onClick={(event) => setDatesAnchor(event.currentTarget)}>
              {card.due_at === null
                ? `Starts ${formatDate(card.start_at ?? '')}`
                : card.start_at === null
                  ? formatDateTime(card.due_at)
                  : `${formatDate(card.start_at)} – ${formatDateTime(card.due_at)}`}
            </Button>
            {pill === null ? null : (
              <span className={cx(styles.pill, PILL_CLASS[state])}>{pill}</span>
            )}
          </div>
        </div>
      )}

      {labelsAnchor === null ? null : (
        <LabelsPopover
          anchor={labelsAnchor}
          boardId={boardId}
          cardId={card.id}
          onClose={() => setLabelsAnchor(null)}
        />
      )}

      {datesAnchor === null ? null : (
        <DatesPopover
          anchor={datesAnchor}
          boardId={boardId}
          cardId={card.id}
          onClose={() => setDatesAnchor(null)}
        />
      )}
    </div>
  );
}
