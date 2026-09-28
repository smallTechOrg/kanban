/**
 * One activity row turned into the English sentence the feed shows (Section 3.8).
 *
 * The table in Section 3.8 is the single source of truth for every sentence, and this module is
 * the only place any of them is written down: the server stores `type` plus a `data` object whose
 * names were denormalised at write time, and never a sentence, so a rename or a deletion cannot
 * make history lie. The actor prefix ("**Vivek** ") belongs to the row that renders this string,
 * not to the string.
 *
 * The card feed applies exactly one substitution on top of that table (Section 2.6.3): when the
 * row's `card_id` is the open card, `card_title` reads "this card", so `card.created` becomes
 * "added this card to To Do" while the board feed keeps "added Write plan to To Do". Pass
 * `openCardId` for the card feed and leave it out for the board feed.
 *
 * Five types have no sentence and `activitySentence` answers `null` for them, which is how the
 * feed skips a row: `card.reordered`, `checklist.moved` and `checklist.item_moved` are reorders
 * that travel over SSE only, and `card.watched` / `card.unwatched` are reserved in
 * `ACTIVITY_TYPES` but never written (watch toggles bypass `write_tx`). An unknown type — one a
 * newer server writes — is answered the same way rather than with a broken sentence.
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

function flag(data: ActivityData, key: string): boolean {
  return data[key] === true;
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

/** "Draft on Steps" — the shape most `checklist.item_*` sentences name the item with. */
function itemOn(data: ActivityData): string {
  return `${text(data, 'item_name')} on ${text(data, 'checklist_name')}`;
}

/**
 * The Section 3.8 table, one renderer per `activities.type`. A type missing from this map has no
 * sentence, and the feed skips its rows.
 */
const RENDERERS: Readonly<Record<string, Renderer>> = {
  // --------------------------------------------------------------------------- board
  'board.created': () => 'created this board',
  'board.renamed': ({ data }) => withFrom('renamed this board', text(data, 'from')),
  'board.description_changed': () => 'updated the description of this board',
  'board.visibility_changed': ({ data }) =>
    `changed the visibility of this board to ${text(data, 'to')}`,
  'board.background_changed': () => 'changed the background of this board',
  'board.closed': () => 'closed this board',
  'board.reopened': () => 're-opened this board',

  // -------------------------------------------------------------------------- member
  'member.added': ({ data }) => `added ${text(data, 'member_name')} to this board`,
  'member.removed': ({ data }) =>
    flag(data, 'self') ? 'left this board' : `removed ${text(data, 'member_name')} from this board`,
  'member.role_changed': ({ data }) =>
    withFrom(
      `changed ${text(data, 'member_name')}'s role to ${text(data, 'role')}`,
      text(data, 'from_role'),
    ),

  // ---------------------------------------------------------------------------- list
  'list.created': ({ data }) => `added list ${text(data, 'list_name')} to this board`,
  'list.renamed': ({ data }) => withFrom(`renamed list ${text(data, 'to')}`, text(data, 'from')),
  'list.moved': ({ data }) => `moved list ${text(data, 'list_name')}`,
  'list.moved_out': ({ data }) =>
    `moved list ${text(data, 'list_name')} to board ${text(data, 'other_board_name')}`,
  'list.moved_in': ({ data }) =>
    `moved list ${text(data, 'list_name')} from board ${text(data, 'other_board_name')}`,
  'list.copied': ({ data }) =>
    `copied list ${text(data, 'list_name')} from ${text(data, 'source_list_name')}`,
  'list.archived': ({ data }) => `archived list ${text(data, 'list_name')}`,
  'list.unarchived': ({ data }) => `sent list ${text(data, 'list_name')} to the board`,
  'list.color_changed': ({ data }) =>
    text(data, 'color') === ''
      ? `removed the color from list ${text(data, 'list_name')}`
      : `changed the color of list ${text(data, 'list_name')}`,

  // ---------------------------------------------------------------------------- card
  'card.created': ({ data, card }) => `added ${card} to ${text(data, 'list_name')}`,
  'card.copied': ({ data, card }) =>
    `copied ${card} from ${text(data, 'source_card_title')} in list ${text(
      data,
      'source_list_name',
    )}`,
  'card.renamed': ({ data }) => withFrom('renamed this card', text(data, 'from')),
  'card.description_changed': () => 'updated the description of this card',
  'card.moved': ({ data }) =>
    `moved this card from ${text(data, 'from_list_name')} to ${text(data, 'to_list_name')}`,
  'card.moved_out': ({ data }) => `moved this card to board ${text(data, 'other_board_name')}`,
  'card.moved_in': ({ data }) => `moved this card from board ${text(data, 'other_board_name')}`,
  'card.archived': () => 'archived this card',
  'card.unarchived': () => 'sent this card to the board',
  'card.deleted': ({ data }) =>
    `deleted card ${text(data, 'card_title')} from ${text(data, 'list_name')}`,
  // One row covers both date columns (Section 4.5), so it also has to read as a sentence when
  // the card was given a start date and no due date at all.
  'card.due_set': ({ data, now }) => {
    const due = text(data, 'due_at');
    return due === ''
      ? `set this card to start ${formatDateTime(text(data, 'start_at'), now)}`
      : `set this card to be due ${formatDateTime(due, now)}`;
  },
  'card.due_removed': () => 'removed the due date from this card',
  'card.due_completed': () => 'marked the due date complete',
  'card.due_incompleted': () => 'marked the due date incomplete',
  'card.cover_changed': () => 'updated the cover of this card',
  'card.cover_removed': () => 'removed the cover from this card',
  'card.template_set': () => 'made this card a template',
  'card.template_unset': () => 'converted this card from a template to a normal card',
  'card.label_added': ({ data }) => `added ${labelPhrase(data)} to this card`,
  'card.label_removed': ({ data }) => `removed ${labelPhrase(data)} from this card`,
  'card.member_added': ({ data }) =>
    flag(data, 'self') ? 'joined this card' : `added ${text(data, 'member_name')} to this card`,
  'card.member_removed': ({ data }) =>
    flag(data, 'self') ? 'left this card' : `removed ${text(data, 'member_name')} from this card`,

  // --------------------------------------------------------------------------- label
  'label.created': ({ data }) => `created ${labelTarget(data)}`,
  'label.updated': ({ data }) => withFrom(`updated ${labelTarget(data)}`, text(data, 'from_name')),
  'label.deleted': ({ data }) =>
    `deleted ${labelTarget(data)} (removed from ${cardCount(count(data, 'card_count'))})`,

  // ----------------------------------------------------------------------- checklist
  'checklist.added': ({ data }) => `added checklist ${text(data, 'checklist_name')} to this card`,
  'checklist.renamed': ({ data }) =>
    withFrom(`renamed checklist ${text(data, 'checklist_name')}`, text(data, 'from')),
  'checklist.deleted': ({ data }) =>
    `removed checklist ${text(data, 'checklist_name')} from this card`,
  'checklist.item_added': ({ data }) =>
    `added ${text(data, 'item_name')} to ${text(data, 'checklist_name')}`,
  'checklist.item_renamed': ({ data }) => withFrom(`renamed ${itemOn(data)}`, text(data, 'from')),
  'checklist.item_deleted': ({ data }) =>
    `removed ${text(data, 'item_name')} from ${text(data, 'checklist_name')}`,
  'checklist.item_checked': ({ data }) => `completed ${itemOn(data)}`,
  'checklist.item_unchecked': ({ data }) =>
    `marked ${text(data, 'item_name')} incomplete on ${text(data, 'checklist_name')}`,
  'checklist.item_due_set': ({ data, now }) =>
    `set ${itemOn(data)} to be due ${formatDateTime(text(data, 'due_at'), now)}`,
  'checklist.item_due_removed': ({ data }) => `removed the due date from ${itemOn(data)}`,
  'checklist.item_assigned': ({ data }) =>
    `assigned ${itemOn(data)} to ${text(data, 'member_name')}`,
  'checklist.item_unassigned': ({ data }) =>
    `unassigned ${text(data, 'member_name')} from ${itemOn(data)}`,
  'checklist.item_converted': ({ data }) => `converted ${text(data, 'item_name')} to a card`,

  // ---------------------------------------------------------------------- attachment
  'attachment.added': ({ data }) => `attached ${text(data, 'attachment_name')} to this card`,
  'attachment.renamed': ({ data }) =>
    withFrom(`renamed the attachment ${text(data, 'attachment_name')}`, text(data, 'from')),
  'attachment.deleted': ({ data }) =>
    `deleted the ${text(data, 'attachment_name')} attachment from this card`,

  // ------------------------------------------------------------------------- comment
  'comment.added': () => 'commented on this card',
  'comment.edited': () => 'edited a comment on this card',
  'comment.deleted': () => 'deleted a comment from this card',
};

/**
 * The Section 3.8 sentence for one activity row, or `null` when the type has none and the feed
 * should skip the row. The actor is not part of it: the feed renders "**Vivek** " in front.
 */
export function activitySentence(row: ActivityRow, options: SentenceOptions = {}): string | null {
  const render = RENDERERS[row.type];
  if (render === undefined) return null;
  const openCardId = options.openCardId ?? null;
  const card =
    openCardId !== null && row.card_id === openCardId ? 'this card' : text(row.data, 'card_title');
  return render({ data: row.data, card, now: options.now ?? new Date() });
}
