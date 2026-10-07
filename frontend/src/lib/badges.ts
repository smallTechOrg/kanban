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
export type BadgeKind = 'due' | 'start' | 'description' | 'items';

export interface CardBadge {
  kind: BadgeKind;
  /** The badge's label: a date range, or `done/total` for the items badge. */
  text?: string;
  /** Only on the `due` badge: which of the four colours it wears. */
  state?: DueState;
  /** Only on the `items` badge: every item is checked, so it goes green. */
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
  if (card.due_at !== null) {
    badges.push({ kind: 'due', text: dueText(card, card.due_at, now), state: dueState(card, now) });
  } else if (card.start_at !== null) {
    badges.push({ kind: 'start', text: `Started ${formatDate(card.start_at, now)}` });
  }
  if (card.badges.description) badges.push({ kind: 'description' });
  if (card.badges.item_total > 0) {
    badges.push({
      kind: 'items',
      text: `${card.badges.item_done}/${card.badges.item_total}`,
      complete: card.badges.item_done === card.badges.item_total,
    });
  }
  return badges;
}

/** What the two counters below need of one item. `CardDetail.items[n]` satisfies it. */
export interface ItemLike {
  is_checked: boolean;
}

/**
 * A card's `done / total`, which `ItemsSection` shows twice — as the `ProgressBar` and as
 * "Hide checked items (n)" — and which `itemCounts` turns into the tile badge. One rule, so
 * the section does not count its own rows.
 */
export function itemProgress(items: readonly ItemLike[]): { done: number; total: number } {
  let done = 0;
  for (const item of items) {
    if (item.is_checked) done += 1;
  }
  return { done, total: items.length };
}

/**
 * `item_done` / `item_total` recomputed from a card's items (Section 4.6).
 *
 * These are the only two numbers of `CardRow.badges` the client can derive itself, and the card
 * modal has to: ticking an item must light the tile up before the server answers, and the item
 * delete answers 204 with no badges at all (Section 5.4.3 -> "Card-modal mutations write to both
 * `['card', id]` and the matching `CardRow`").
 */
export function itemCounts(
  items: readonly ItemLike[],
): Pick<BadgeCounts, 'item_done' | 'item_total'> {
  const { done, total } = itemProgress(items);
  return { item_done: done, item_total: total };
}
