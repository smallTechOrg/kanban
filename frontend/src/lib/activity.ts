/**
 * One activity row turned into the English sentence the feed shows (Section 3.8).
 *
 * The table in Section 3.8 is the single source of truth for every sentence, and this module is
 * the only place any of them is written down: the server stores `type` plus a `data` object whose
 * names were denormalised at write time, and never a sentence, so a rename or a deletion cannot
 * make history lie.
 *
 * The sentences are written in sentence case and name no actor. One person uses this board, so
 * "added this card to To Do" would have had nobody to attribute it to and the feed reads as the
 * record of what happened rather than of who did it.
 *
 * The card feed applies exactly one substitution on top of that table (Section 2.6.3): when the
 * row's `card_id` is the open card, `card_title` reads "this card", so `card.created` becomes
 * "Added this card to To Do" while the board feed keeps "Added Write plan to To Do". Pass
 * `openCardId` for the card feed and leave it out for the board feed.
 *
 * Two types have no sentence and `activitySentence` answers `null` for them, which is how the
 * feed skips a row: `card.reordered` and `item.moved` are reorders that travel over SSE only.
 * An unknown type — one a newer server writes — is answered the same way rather than with a
 * broken sentence.
 */
import { formatDateTime } from './dates';

/** An `activities` row as the feed carries it: the fields a sentence can be built from. */
export interface ActivityRow {
  type: string;
  card_id: number | null;
  data: Readonly<Record<string, unknown>>;
}

export interface SentenceOptions {
  /** The card whose modal is open: its `card_title` renders as "this card" (Section 2.6.3). */
  openCardId?: number | null;
  /** Passed in so the two sentences carrying a date are deterministic in tests. */
  now?: Date;
}

type ActivityData = Readonly<Record<string, unknown>>;

interface SentenceInput {
  data: ActivityData;
  /** The card reference: "this card" in the open card's feed, the stored title otherwise. */
  card: string;
  now: Date;
}

type Renderer = (input: SentenceInput) => string;

/** A denormalised name from `activities.data`; empty when the row does not carry it. */
function text(data: ActivityData, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

function count(data: ActivityData, key: string): number {
  const value = data[key];
  return typeof value === 'number' ? value : 0;
}

/** The "(from Doing)" tail the rename sentences and `label.updated` share (Section 3.8). */
function withFrom(sentence: string, from: string): string {
  return from === '' ? sentence : `${sentence} (from ${from})`;
}

/** "3 cards" / "1 card", for the tail of `label.deleted`. */
function cardCount(total: number): string {
  return total === 1 ? '1 card' : `${total} cards`;
}

/** "the red Urgent label", or "the red label" for one of the six unnamed seeded labels. */
function labelPhrase(data: ActivityData): string {
  const name = text(data, 'label_name');
  const color = text(data, 'label_color');
  return name === '' ? `the ${color} label` : `the ${color} ${name} label`;
}

/** How the three `label.*` sentences name their label: "label Urgent", or "the red label". */
function labelTarget(data: ActivityData): string {
  const name = text(data, 'label_name');
  return name === '' ? labelPhrase(data) : `label ${name}`;
}

/**
 * The Section 3.8 table, one renderer per `activities.type`. A type missing from this map has no
 * sentence, and the feed skips its rows.
 */
const RENDERERS: Readonly<Record<string, Renderer>> = {
  // --------------------------------------------------------------------------- board
  'board.created': () => 'Created this board',
  'board.renamed': ({ data }) => withFrom('Renamed this board', text(data, 'from')),
  'board.description_changed': () => 'Updated the description of this board',
  'board.background_changed': () => 'Changed the background of this board',
  'board.closed': () => 'Closed this board',
  'board.reopened': () => 'Re-opened this board',

  // ---------------------------------------------------------------------------- list
  'list.created': ({ data }) => `Added list ${text(data, 'list_name')} to this board`,
  'list.renamed': ({ data }) => withFrom(`Renamed list ${text(data, 'to')}`, text(data, 'from')),
  'list.moved': ({ data }) => `Moved list ${text(data, 'list_name')}`,
  'list.moved_out': ({ data }) =>
    `Moved list ${text(data, 'list_name')} to board ${text(data, 'other_board_name')}`,
  'list.moved_in': ({ data }) =>
    `Moved list ${text(data, 'list_name')} from board ${text(data, 'other_board_name')}`,
  'list.copied': ({ data }) =>
    `Copied list ${text(data, 'list_name')} from ${text(data, 'source_list_name')}`,
  'list.archived': ({ data }) => `Archived list ${text(data, 'list_name')}`,
  'list.unarchived': ({ data }) => `Sent list ${text(data, 'list_name')} to the board`,
  'list.color_changed': ({ data }) =>
    text(data, 'color') === ''
      ? `Removed the color from list ${text(data, 'list_name')}`
      : `Changed the color of list ${text(data, 'list_name')}`,

  // ---------------------------------------------------------------------------- card
  'card.created': ({ data, card }) => `Added ${card} to ${text(data, 'list_name')}`,
  // A card has no copy endpoint; this row is written once per card by a *list* copy.
  'card.copied': ({ data, card }) =>
    `Copied ${card} from ${text(data, 'source_card_title')} in list ${text(
      data,
      'source_list_name',
    )}`,
  'card.renamed': ({ data }) => withFrom('Renamed this card', text(data, 'from')),
  'card.description_changed': () => 'Updated the description of this card',
  'card.moved': ({ data }) =>
    `Moved this card from ${text(data, 'from_list_name')} to ${text(data, 'to_list_name')}`,
  'card.archived': () => 'Archived this card',
  'card.unarchived': () => 'Sent this card to the board',
  'card.deleted': ({ data }) =>
    `Deleted card ${text(data, 'card_title')} from ${text(data, 'list_name')}`,
  // One row covers both date columns (Section 4.5), so it also has to read as a sentence when
  // the card was given a start date and no due date at all.
  'card.due_set': ({ data, now }) => {
    const due = text(data, 'due_at');
    return due === ''
      ? `Set this card to start ${formatDateTime(text(data, 'start_at'), now)}`
      : `Set this card to be due ${formatDateTime(due, now)}`;
  },
  'card.due_removed': () => 'Removed the due date from this card',
  'card.due_completed': () => 'Marked the due date complete',
  'card.due_incompleted': () => 'Marked the due date incomplete',
  'card.label_added': ({ data }) => `Added ${labelPhrase(data)} to this card`,
  'card.label_removed': ({ data }) => `Removed ${labelPhrase(data)} from this card`,

  // --------------------------------------------------------------------------- label
  'label.created': ({ data }) => `Created ${labelTarget(data)}`,
  'label.updated': ({ data }) => withFrom(`Updated ${labelTarget(data)}`, text(data, 'from_name')),
  'label.deleted': ({ data }) =>
    `Deleted ${labelTarget(data)} (removed from ${cardCount(count(data, 'card_count'))})`,

  // ---------------------------------------------------------------------------- item
  'item.added': ({ data }) => `Added ${text(data, 'item_name')} to this card`,
  'item.renamed': ({ data }) =>
    withFrom(`Renamed ${text(data, 'item_name')}`, text(data, 'from')),
  'item.deleted': ({ data }) => `Removed ${text(data, 'item_name')} from this card`,
  'item.checked': ({ data }) => `Completed ${text(data, 'item_name')}`,
  'item.unchecked': ({ data }) => `Marked ${text(data, 'item_name')} incomplete`,
  'item.due_set': ({ data, now }) =>
    `Set ${text(data, 'item_name')} to be due ${formatDateTime(text(data, 'due_at'), now)}`,
  'item.due_removed': ({ data }) => `Removed the due date from ${text(data, 'item_name')}`,
};

/**
 * The Section 3.8 sentence for one activity row, or `null` when the type has none and the feed
 * should skip the row.
 */
export function activitySentence(row: ActivityRow, options: SentenceOptions = {}): string | null {
  const render = RENDERERS[row.type];
  if (render === undefined) return null;
  const openCardId = options.openCardId ?? null;
  const card =
    openCardId !== null && row.card_id === openCardId ? 'this card' : text(row.data, 'card_title');
  return render({ data: row.data, card, now: options.now ?? new Date() });
}
