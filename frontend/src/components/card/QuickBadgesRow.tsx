import { useState, type ReactElement } from 'react';
import { Check, Eye, Plus } from 'lucide-react';
import { Avatar, Button, cx } from '@/components/ui';
import { LabelChip } from '@/components/ui/LabelChip';
import { useLabels, useMembers } from '@/hooks/useBoardData';
import { useToggleWatch, useUpdateCardFields } from '@/hooks/useCardMutations';
import { useMeta } from '@/hooks/useMeta';
import type { CardDetail } from '@/api/types';
import { dueState, type DueState } from '@/lib/badges';
import type { LabelRow, MemberRow } from '@/lib/boardState';
import type { LabelPalette } from '@/lib/colors';
import { formatDate, formatDateTime } from '@/lib/dates';
import { useUiStore } from '@/store/uiStore';
import { DatesPopover } from './DatesPopover';
import { LabelsPopover } from './LabelsPopover';
import { MembersPopover } from './MembersPopover';
import styles from './QuickBadgesRow.module.css';

const NO_LABELS: readonly LabelRow[] = [];
const NO_MEMBERS: readonly MemberRow[] = [];
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
  readOnly?: boolean;
}

/**
 * The quick badges row of Section 2.6.3: the groups that show what the card already carries,
 * each with a 12px label and each rendered only when it has data — so an empty card shows
 * nothing here and every one of these values is added from the sidebar instead.
 *
 * Notifications is the one group that is a control rather than data, so it is also the one that
 * renders unconditionally: Section 2.6.3 describes the button in both states ("`default` button
 * 'Watch'" and "when watching, a 24px `#0079BF` square with a white check"), which only holds if
 * it is there before anybody is watching. It also ignores `readOnly`, because watching is
 * per-user state an observer may write on a card they cannot edit (Section 4.5).
 */
export function QuickBadgesRow({
  boardId,
  card,
  readOnly = false,
}: QuickBadgesRowProps): ReactElement {
  const [membersAnchor, setMembersAnchor] = useState<HTMLElement | null>(null);
  const [labelsAnchor, setLabelsAnchor] = useState<HTMLElement | null>(null);
  const [datesAnchor, setDatesAnchor] = useState<HTMLElement | null>(null);
  const labels = useLabels(boardId).data ?? NO_LABELS;
  const members = useMembers(boardId).data ?? NO_MEMBERS;
  const palette: LabelPalette = useMeta().data?.label_colors ?? NO_PALETTE;
  const colorBlind = useUiStore((state) => state.colorBlindLabels);
  const update = useUpdateCardFields(boardId, card.id);
  const toggleWatch = useToggleWatch(boardId, card.id);

  const chips = card.label_ids
    .map((labelId) => labels.find((label) => label.id === labelId))
    .filter((label): label is LabelRow => label !== undefined);

  const assigned = card.member_ids
    .map((userId) => members.find((member) => member.id === userId))
    .filter((member): member is MemberRow => member !== undefined);

  const hasDates = card.start_at !== null || card.due_at !== null;
  const state = dueState(card, new Date());
  const pill = PILL_TEXT[state];

  return (
    <div className={styles.row}>
      {assigned.length === 0 ? null : (
        <div className={styles.group}>
          <span className={styles.label} id="card-members-label">
            Members
          </span>
          <div className={styles.values} aria-labelledby="card-members-label">
            {assigned.map((member) => (
              <Avatar
                key={member.id}
                name={member.full_name}
                color={member.avatar_color}
                size={32}
                tooltip
              />
            ))}
            {readOnly ? null : (
              <button
                type="button"
                className={cx(styles.add, styles.addRound)}
                aria-label="Edit members"
                onClick={(event) => setMembersAnchor(event.currentTarget)}
              >
                <Plus aria-hidden="true" size={16} />
              </button>
            )}
          </div>
        </div>
      )}

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
            {readOnly ? null : (
              <button
                type="button"
                className={styles.add}
                aria-label="Edit labels"
                onClick={(event) => setLabelsAnchor(event.currentTarget)}
              >
                <Plus aria-hidden="true" size={16} />
              </button>
            )}
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
                disabled={readOnly}
                aria-label="Mark the due date complete"
                onChange={(event) => update.mutate({ due_complete: event.target.checked })}
              />
            )}
            <Button disabled={readOnly} onClick={(event) => setDatesAnchor(event.currentTarget)}>
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

      <div className={styles.group}>
        <span className={styles.label} id="card-notifications-label">
          Notifications
        </span>
        <div className={styles.values} aria-labelledby="card-notifications-label">
          <span className={styles.watchRow}>
            <Button
              icon={<Eye aria-hidden="true" />}
              onClick={() => toggleWatch.mutate(!card.is_watching)}
            >
              Watch
            </Button>
            {card.is_watching ? (
              <span className={styles.watchCheck}>
                <Check aria-hidden="true" size={16} />
                <span className={styles.state}>Watching this card</span>
              </span>
            ) : null}
          </span>
        </div>
      </div>

      {membersAnchor === null ? null : (
        <MembersPopover
          anchor={membersAnchor}
          boardId={boardId}
          cardId={card.id}
          onClose={() => setMembersAnchor(null)}
        />
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
