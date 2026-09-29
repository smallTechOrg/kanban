import { memo, type ReactElement } from 'react';
import { AlignLeft, Check, CheckSquare, Clock, Paperclip, Square } from 'lucide-react';
import { Tooltip, cx } from '@/components/ui';
import { cardBadges, type CardBadge, type DueState } from '@/lib/badges';
import type { CardRow } from '@/lib/boardState';
import styles from './CardBadges.module.css';

/** Section 2.5.3: the description badge is the only one with its own tooltip copy. */
const DESCRIPTION_TOOLTIP = 'This card has a description.';

/** The four colours of the due pill (Section 2.5.3); `none` stays transparent. */
const DUE_CLASS: Record<DueState, string | undefined> = {
  none: undefined,
  soon: styles.soon,
  overdue: styles.overdue,
  complete: styles.complete,
};

const DUE_TITLE: Record<DueState, string> = {
  none: 'Due date',
  soon: 'Due soon',
  overdue: 'Overdue',
  complete: 'Due date complete',
};

/** The accessible name of one badge; the icon itself is always `aria-hidden`. */
function badgeTitle(badge: CardBadge): string {
  switch (badge.kind) {
    case 'due':
      return DUE_TITLE[badge.state ?? 'none'];
    case 'start':
      return 'Start date';
    case 'description':
      return DESCRIPTION_TOOLTIP;
    case 'attachments':
      return 'Attachments';
    case 'checklist':
      return 'Checklist items';
  }
}

function badgeIcon(badge: CardBadge): ReactElement {
  switch (badge.kind) {
    case 'due':
      return badge.state === 'complete' ? (
        <Check aria-hidden="true" />
      ) : (
        <Clock aria-hidden="true" />
      );
    case 'start':
      return <Clock aria-hidden="true" />;
    case 'description':
      return <AlignLeft aria-hidden="true" />;
    case 'attachments':
      return <Paperclip aria-hidden="true" />;
    case 'checklist':
      return <CheckSquare aria-hidden="true" />;
  }
}

export interface CardBadgesProps {
  card: CardRow;
  /** Passed in by the tests so the due states are deterministic (`lib/badges.ts` rule). */
  now?: Date;
  /**
   * Turns the due badge into the hover checkbox of Section 2.5.3: the clock swaps for a
   * checkbox and clicking it toggles `due_complete` without opening the card. Without it the
   * badge is the plain pill — the row is also read where nothing may be written.
   */
  onToggleDueComplete?: (next: boolean) => void;
}

/**
 * The badge row of Section 2.5.3. Which badges exist is decided once, in `lib/badges.ts`; this
 * component only paints them, in that order, and renders nothing at all when the card has none —
 * a zero count is an absent badge, not a "0".
 *
 * Every badge lights up from the card's own row — the paperclip from `badges.attachments`, which
 * the board payload carries — and the two checklist numbers are recomputed on the spot by
 * `lib/badges.ts`, so ticking an item repaints the tile at once.
 *
 * The due badge is the only interactive one. Its accessible name keeps the visible date and adds
 * the action ("Sep 24 Mark complete") rather than replacing it with a label, which WCAG 2.5.3
 * forbids and which would hide the date the badge is there to show.
 */
function CardBadgesView({ card, now, onToggleDueComplete }: CardBadgesProps): ReactElement | null {
  const badges = cardBadges(card, now ?? new Date());
  if (badges.length === 0) return null;

  return (
    <div className={styles.row}>
      {badges.map((badge) => {
        const title = badgeTitle(badge);
        const badgeClass = cx(
          styles.badge,
          badge.kind === 'due' && DUE_CLASS[badge.state ?? 'none'],
          badge.kind === 'checklist' && badge.complete === true && styles.complete,
        );
        if (badge.kind === 'due' && onToggleDueComplete !== undefined) {
          const isComplete = badge.state === 'complete';
          return (
            <button
              key={badge.kind}
              type="button"
              className={cx(badgeClass, styles.dueButton)}
              title={title}
              aria-pressed={isComplete}
              onClick={(event) => {
                // The tile around the badge is a link; toggling must not follow it.
                event.preventDefault();
                event.stopPropagation();
                onToggleDueComplete(!isComplete);
              }}
            >
              <span className={styles.stateIcon}>{badgeIcon(badge)}</span>
              <span className={styles.checkboxIcon}>
                {isComplete ? <CheckSquare aria-hidden="true" /> : <Square aria-hidden="true" />}
              </span>
              <span className={styles.text}>{badge.text}</span>
              <span className={styles.action}>
                {isComplete ? 'Mark incomplete' : 'Mark complete'}
              </span>
            </button>
          );
        }
        if (badge.kind === 'description') {
          return (
            <Tooltip key={badge.kind} content={DESCRIPTION_TOOLTIP}>
              <span className={badgeClass} role="img" aria-label={title}>
                {badgeIcon(badge)}
              </span>
            </Tooltip>
          );
        }
        if (badge.text === undefined) {
          return (
            <span className={badgeClass} role="img" aria-label={title} key={badge.kind}>
              {badgeIcon(badge)}
            </span>
          );
        }
        return (
          <span className={badgeClass} title={title} key={badge.kind}>
            {badgeIcon(badge)}
            <span className={styles.text}>{badge.text}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Section 5.11: one card changing must repaint one badge row. */
export const CardBadges = memo(CardBadgesView);
