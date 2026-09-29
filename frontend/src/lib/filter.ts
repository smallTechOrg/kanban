/**
 * The board filter: what it is, whether one card passes it, and how it travels in the URL
 * (Section 2.3.3). The one place any of that is decided (CLAUDE.md section 3).
 *
 * `FilterPopover` collects five groups of criteria — keyword, card status, due date, labels and
 * activity — plus the Match select. Inside a group the selections are OR'd (two labels means
 * "either label"); between groups the Match select decides: "Any match" (the default) passes a
 * card that satisfies at least one *selected* group, "Exact match" one that satisfies all of
 * them. A filter with nothing selected passes every card, which is what makes the filter-off
 * state free of special cases.
 *
 * The predicate is pure and takes `now` plus the board's own label map, because the keyword
 * searches label names the card only carries as ids and every date rule is relative
 * (`matchesFilter(card, filter, {now, labelsById})`). Descriptions are deliberately not
 * searched: that is `GET /api/search`, Section 4.7.
 *
 * The state lives in `uiStore.filter` and is mirrored to the query string by
 * `filterToSearchParams` / `filterFromSearchParams`, so a filtered board survives a reload and can
 * be shared as a link. Every key is omitted at its default.
 */
import { dueState } from './badges';
import type { CardRow, Id } from './boardState';

export type DueFilter = 'any' | 'none' | 'overdue' | 'day' | 'week' | 'month';
export type StatusFilter = 'any' | 'complete' | 'incomplete';
export type ActivityFilter = 'any' | 'week' | '2weeks' | '4weeks' | 'inactive';
export type MatchMode = 'any' | 'all';

/** The filter as `uiStore.filter` holds it (Section 5.13). */
export interface BoardFilter {
  q: string;
  labelIds: Id[];
  noLabels: boolean;
  due: DueFilter;
  status: StatusFilter;
  activity: ActivityFilter;
  match: MatchMode;
}

/** Nothing selected: the state the X shortcut and "Clear all" return to. */
export const EMPTY_FILTER: BoardFilter = {
  q: '',
  labelIds: [],
  noLabels: false,
  due: 'any',
  status: 'any',
  activity: 'any',
  match: 'any',
};

/** What the predicate reads off a card; a `CardRow` of the board cache satisfies it. */
export type FilterCard = Pick<
  CardRow,
  'title' | 'label_ids' | 'due_at' | 'due_complete' | 'is_template' | 'updated_at'
>;

/** A label as the keyword search reads it: `BoardState.labels` satisfies this. */
export interface FilterLabel {
  name: string;
}

export interface FilterContext {
  /** Passed in so both the board and its test are deterministic. */
  now: Date;
  labelsById: Readonly<Record<Id, FilterLabel | undefined>>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** The three "Due in the next …" windows and the four Activity windows, in milliseconds. */
const DUE_WINDOW_MS: Record<'day' | 'week' | 'month', number> = {
  day: DAY_MS,
  week: WEEK_MS,
  month: 4 * WEEK_MS,
};

const ACTIVITY_WINDOW_MS: Record<'week' | '2weeks' | '4weeks' | 'inactive', number> = {
  week: WEEK_MS,
  '2weeks': 2 * WEEK_MS,
  '4weeks': 4 * WEEK_MS,
  inactive: 4 * WEEK_MS,
};

/** One group of the popover: whether the reader selected anything in it, and whether it holds. */
interface Criterion {
  selected: boolean;
  matched: boolean;
}

function includesAny(haystack: readonly Id[], needles: readonly Id[]): boolean {
  return needles.some((id) => haystack.includes(id));
}

/**
 * The keyword: a case-insensitive substring of the title or of any of the card's label names
 * (Section 2.3.3).
 */
function keywordCriterion(
  card: FilterCard,
  filter: BoardFilter,
  context: FilterContext,
): Criterion {
  const needle = filter.q.trim().toLowerCase();
  if (needle === '') return { selected: false, matched: false };
  const words = [card.title, ...card.label_ids.map((id) => context.labelsById[id]?.name ?? '')];
  return {
    selected: true,
    matched: words.some((word) => word.toLowerCase().includes(needle)),
  };
}

function labelsCriterion(card: FilterCard, filter: BoardFilter): Criterion {
  return {
    selected: filter.noLabels || filter.labelIds.length > 0,
    matched:
      (filter.noLabels && card.label_ids.length === 0) ||
      includesAny(card.label_ids, filter.labelIds),
  };
}

/**
 * "Marked as complete" / "Not marked as complete". A template card matches neither: it is a
 * stencil, not work in progress (Section 7.2 M4), and the same holds for the due windows below.
 */
function statusCriterion(card: FilterCard, filter: BoardFilter): Criterion {
  if (filter.status === 'any') return { selected: false, matched: false };
  if (card.is_template) return { selected: true, matched: false };
  return {
    selected: true,
    matched: filter.status === 'complete' ? card.due_complete : !card.due_complete,
  };
}

/**
 * "No dates", "Overdue" and the three windows. `overdue` is `lib/badges.ts`'s own state, so the
 * red badge and the filter can never disagree; a window matches a card whose due date falls at or
 * before `now + span` and is not yet complete, which puts an overdue card inside every window
 * exactly as Trello's own "due in the next day" does.
 */
function dueCriterion(card: FilterCard, filter: BoardFilter, now: Date): Criterion {
  if (filter.due === 'any') return { selected: false, matched: false };
  if (card.is_template) return { selected: true, matched: false };
  if (filter.due === 'none') return { selected: true, matched: card.due_at === null };
  if (filter.due === 'overdue')
    return { selected: true, matched: dueState(card, now) === 'overdue' };
  const due = card.due_at === null ? null : Date.parse(card.due_at);
  const within =
    due !== null &&
    !Number.isNaN(due) &&
    !card.due_complete &&
    due <= now.getTime() + DUE_WINDOW_MS[filter.due];
  return { selected: true, matched: within };
}

/**
 * The Activity radio group, driven by `cards.updated_at`, which every write to the card row bumps
 * (Section 2.3.3): the first three windows match a card touched inside them, `inactive` one that
 * has not been touched for four weeks.
 */
function activityCriterion(card: FilterCard, filter: BoardFilter, now: Date): Criterion {
  if (filter.activity === 'any') return { selected: false, matched: false };
  const updated = Date.parse(card.updated_at);
  if (Number.isNaN(updated)) return { selected: true, matched: false };
  const edge = now.getTime() - ACTIVITY_WINDOW_MS[filter.activity];
  return {
    selected: true,
    matched: filter.activity === 'inactive' ? updated < edge : updated >= edge,
  };
}

/**
 * Whether one card survives the filter. `false` is what puts `display: none` on its tile; the
 * lists themselves always render (Section 2.3.3).
 */
export function matchesFilter(
  card: FilterCard,
  filter: BoardFilter,
  context: FilterContext,
): boolean {
  const criteria = [
    keywordCriterion(card, filter, context),
    statusCriterion(card, filter),
    dueCriterion(card, filter, context.now),
    labelsCriterion(card, filter),
    activityCriterion(card, filter, context.now),
  ].filter((criterion) => criterion.selected);

  if (criteria.length === 0) return true;
  return filter.match === 'all'
    ? criteria.every((criterion) => criterion.matched)
    : criteria.some((criterion) => criterion.matched);
}

/**
 * How many criteria are selected — the "N filters" the header pill counts (Section 2.3.1). The
 * Match select is not a criterion: it only says how the others combine.
 */
export function activeFilterCount(filter: BoardFilter): number {
  return (
    (filter.q.trim() === '' ? 0 : 1) +
    (filter.noLabels ? 1 : 0) +
    filter.labelIds.length +
    (filter.status === 'any' ? 0 : 1) +
    (filter.due === 'any' ? 0 : 1) +
    (filter.activity === 'any' ? 0 : 1)
  );
}

/** Whether anything is selected at all: what turns the header button into the pill. */
export function isFilterActive(filter: BoardFilter): boolean {
  return activeFilterCount(filter) > 0;
}

/** The "No labels" token of the `labels=` key (Section 2.3.3). */
const NONE = 'none';

const DUE_VALUES: readonly DueFilter[] = ['none', 'overdue', 'day', 'week', 'month'];
const STATUS_VALUES: readonly StatusFilter[] = ['complete', 'incomplete'];
const ACTIVITY_VALUES: readonly ActivityFilter[] = ['week', '2weeks', '4weeks', 'inactive'];

function idList(ids: readonly Id[], none: boolean): string {
  const tokens = ids.map(String);
  return (none ? [NONE, ...tokens] : tokens).join(',');
}

/**
 * The filter as query parameters, every key omitted at its default (Section 2.3.3):
 * `?q=launch&labels=1,2&due=overdue&status=incomplete&activity=week&match=all`.
 * "No labels" is the token `none` in the same key, so `labels=none` and `labels=1,2` are the two
 * forms the plan lists and `labels=none,1,2` is the one the popover allows by checking both.
 */
export function filterToSearchParams(filter: BoardFilter): URLSearchParams {
  const params = new URLSearchParams();
  const q = filter.q.trim();
  if (q !== '') params.set('q', q);
  if (filter.noLabels || filter.labelIds.length > 0) {
    params.set('labels', idList(filter.labelIds, filter.noLabels));
  }
  if (filter.status !== 'any') params.set('status', filter.status);
  if (filter.due !== 'any') params.set('due', filter.due);
  if (filter.activity !== 'any') params.set('activity', filter.activity);
  if (filter.match === 'all') params.set('match', 'all');
  return params;
}

/** One `labels=` value: the `none` flag and the ids, ignoring anything else. */
function parseIdList(raw: string | null): { ids: Id[]; none: boolean } {
  if (raw === null) return { ids: [], none: false };
  const tokens = raw.split(',');
  const ids: Id[] = [];
  for (const token of tokens) {
    const id = Number(token);
    if (Number.isInteger(id) && id >= 1 && !ids.includes(id)) ids.push(id);
  }
  return { ids, none: tokens.includes(NONE) };
}

function parseChoice<T extends string>(raw: string | null, allowed: readonly T[]): T | null {
  if (raw === null) return null;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

/**
 * The filter a URL describes. Anything unreadable falls back to that key's default, so a
 * hand-edited or truncated link opens a board rather than an error (Section 2.10 gives the filter
 * no error state).
 */
export function filterFromSearchParams(params: URLSearchParams): BoardFilter {
  const labels = parseIdList(params.get('labels'));
  return {
    q: params.get('q') ?? '',
    labelIds: labels.ids,
    noLabels: labels.none,
    status: parseChoice(params.get('status'), STATUS_VALUES) ?? 'any',
    due: parseChoice(params.get('due'), DUE_VALUES) ?? 'any',
    activity: parseChoice(params.get('activity'), ACTIVITY_VALUES) ?? 'any',
    match: params.get('match') === 'all' ? 'all' : 'any',
  };
}
