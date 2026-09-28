/**
 * The due-date state machine and the badge set a `CardTile` shows (Section 2.5.3).
 *
 * `dueState` is the only place the four states are decided: **none** (no due date, or the badge
 * is transparent), **soon** (less than 24 hours away and not complete), **overdue** (in the
 * past and not complete) and **complete** (`due_complete`). `now` is always passed in, so both
 * the tile and its test are deterministic (CLAUDE.md section 3 puts this rule here and the text
 * formats in `lib/dates.ts`).
 */
import { formatDate } from './dates';
import type { BadgeCounts, CardRow } from './boardState';

export type DueState = 'none' | 'soon' | 'overdue' | 'complete';

/** "Due soon" is Trello's window: the badge turns yellow inside the last 24 hours. */
export const DUE_SOON_MS = 24 * 60 * 60 * 1000;

/** The badges of Section 2.5.3, in the left-to-right order the row renders them. */
export type BadgeKind =
  'watch' | 'due' | 'start' | 'description' | 'comments' | 'attachments' | 'checklist';

export interface CardBadge {
  kind: BadgeKind;
  /** The badge's label: a date range, a count, or `done/total` for a checklist. */
  text?: string;
  /** Only on the `due` badge: which of the four colours it wears. */
  state?: DueState;
  /** Only on the `checklist` badge: every item is checked, so it goes green. */
  complete?: boolean;
}

type DueFields = Pick<CardRow, 'due_at' | 'due_complete'>;

/** `none` | `soon` | `overdue` | `complete` for one card against a fixed `now` (Section 2.5.3). */
export function dueState(card: DueFields, now: Date): DueState {
  if (card.due_at === null) return 'none';
  const due = Date.parse(card.due_at);
  if (Number.isNaN(due)) return 'none';
  if (card.due_complete) return 'complete';
  const remaining = due - now.getTime();
  if (remaining < 0) return 'overdue';
  return remaining < DUE_SOON_MS ? 'soon' : 'none';
}

/** "Sep 24" or "Sep 24 – Oct 1" when the card also has a start date (Section 2.5.3). */
function dueText(card: CardRow, dueAt: string, now: Date): string {
  const due = formatDate(dueAt, now);
  return card.start_at === null ? due : `${formatDate(card.start_at, now)} – ${due}`;
}

/**
 * The badges one tile shows, in order. A card with a start date but no due date shows
 * "Started Sep 20" in the same slot; every other badge is omitted when its count is zero.
 */
export function cardBadges(card: CardRow, now: Date): CardBadge[] {
  const badges: CardBadge[] = [];
  if (card.is_watching) badges.push({ kind: 'watch' });
  if (card.due_at !== null) {
    badges.push({ kind: 'due', text: dueText(card, card.due_at, now), state: dueState(card, now) });
  } else if (card.start_at !== null) {
    badges.push({ kind: 'start', text: `Started ${formatDate(card.start_at, now)}` });
  }
  if (card.badges.description) badges.push({ kind: 'description' });
  if (card.badges.comments > 0) {
    badges.push({ kind: 'comments', text: String(card.badges.comments) });
  }
  if (card.badges.attachments > 0) {
    badges.push({ kind: 'attachments', text: String(card.badges.attachments) });
  }
  if (card.badges.checklist_total > 0) {
    badges.push({
      kind: 'checklist',
      text: `${card.badges.checklist_done}/${card.badges.checklist_total}`,
      complete: card.badges.checklist_done === card.badges.checklist_total,
    });
  }
  return badges;
}

/** What `checklistCounts` needs of one checklist: `CardDetail.checklists[n]` satisfies it. */
export interface ChecklistLike {
  items: readonly { is_checked: boolean }[];
}

/**
 * `checklist_done` / `checklist_total` recomputed from a card's checklists (Section 4.6).
 *
 * These are the only two numbers of `CardRow.badges` the client can derive itself, and the card
 * modal has to: ticking an item must light the tile up before the server answers, and the
 * checklist and item deletes answer 204 with no badges at all (Section 5.4.3 -> "Card-modal
 * mutations write to both `['card', id]` and the matching `CardRow`").
 */
export function checklistCounts(
  checklists: readonly ChecklistLike[],
): Pick<BadgeCounts, 'checklist_done' | 'checklist_total'> {
  let done = 0;
  let total = 0;
  for (const checklist of checklists) {
    const progress = checklistProgress(checklist);
    done += progress.done;
    total += progress.total;
  }
  return { checklist_done: done, checklist_total: total };
}

/**
 * One checklist's `done / total`, which `ChecklistSection` shows twice — as the `ProgressBar`
 * and as "Hide checked items (n)" — and which `checklistCounts` sums for the tile badge. One
 * rule, so the section does not count its own rows.
 */
export function checklistProgress(checklist: ChecklistLike): { done: number; total: number } {
  let done = 0;
  for (const item of checklist.items) {
    if (item.is_checked) done += 1;
  }
  return { done, total: checklist.items.length };
}
