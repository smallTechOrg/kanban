import { describe, expect, it } from 'vitest';
import { activitySentence, type ActivityRow } from './activity';

// Local-time constructors so the rendered dates hold in any timezone (as in badges.test.ts).
const NOW = new Date(2026, 8, 24, 18, 0, 0); // 24 Sep 2026, 18:00 local
const DUE_ISO = new Date(2026, 8, 30, 15, 0, 0).toISOString(); // 30 Sep 2026, 3:00 PM local
const ITEM_DUE_ISO = new Date(2026, 8, 30, 12, 0, 0).toISOString(); // 12:00 PM local

const OPEN_CARD_ID = 42;

function row(
  type: string,
  data: Record<string, unknown> = {},
  cardId: number | null = OPEN_CARD_ID,
): ActivityRow {
  return { type, card_id: cardId, data };
}

/** Every row of the Section 3.8 table, rendered as the open card's feed shows it. */
const SENTENCES: [string, Record<string, unknown>, string][] = [
  ['board.created', { board_name: 'Launch' }, 'Created this board'],
  ['board.renamed', { from: 'Launch', to: 'Launch v2' }, 'Renamed this board (from Launch)'],
  ['board.description_changed', {}, 'Updated the description of this board'],
  [
    'board.background_changed',
    { background_type: 'color', background_value: 'green' },
    'Changed the background of this board',
  ],
  ['board.closed', {}, 'Closed this board'],
  ['board.reopened', {}, 'Re-opened this board'],

  ['list.created', { list_name: 'Doing' }, 'Added list Doing to this board'],
  ['list.renamed', { from: 'Doing', to: 'In progress' }, 'Renamed list In progress (from Doing)'],
  ['list.moved', { list_name: 'Done', index: 2 }, 'Moved list Done'],
  [
    'list.moved_out',
    { list_name: 'Done', other_board_id: 9, other_board_name: 'Ops', index: 2 },
    'Moved list Done to board Ops',
  ],
  [
    'list.moved_in',
    { list_name: 'Done', other_board_id: 7, other_board_name: 'Launch', index: 2 },
    'Moved list Done from board Launch',
  ],
  [
    'list.copied',
    { list_name: 'Done (copy)', source_list_id: 4, source_list_name: 'Done', card_count: 5 },
    'Copied list Done (copy) from Done',
  ],
  ['list.archived', { list_name: 'Done' }, 'Archived list Done'],
  ['list.unarchived', { list_name: 'Done' }, 'Sent list Done to the board'],
  ['list.color_changed', { list_name: 'Done', color: 'green' }, 'Changed the color of list Done'],
  ['list.color_changed', { list_name: 'Done', color: null }, 'Removed the color from list Done'],

  ['card.created', { card_title: 'Write plan', list_name: 'To Do' }, 'Added this card to To Do'],
  [
    'card.copied',
    { card_title: 'Write plan', source_card_title: 'Plan v1', source_list_name: 'Backlog' },
    'Copied this card from Plan v1 in list Backlog',
  ],
  ['card.renamed', { from: 'Plan', to: 'Write plan' }, 'Renamed this card (from Plan)'],
  [
    'card.description_changed',
    { card_title: 'Write plan' },
    'Updated the description of this card',
  ],
  [
    'card.moved',
    {
      card_title: 'Write plan',
      from_list_id: 1,
      from_list_name: 'To Do',
      to_list_id: 2,
      to_list_name: 'Doing',
      index: 0,
    },
    'Moved this card from To Do to Doing',
  ],
  ['card.archived', { card_title: 'Write plan' }, 'Archived this card'],
  ['card.unarchived', { card_title: 'Write plan' }, 'Sent this card to the board'],
  [
    'card.deleted',
    { card_title: 'Write plan', list_name: 'Done' },
    'Deleted card Write plan from Done',
  ],
  [
    'card.due_set',
    { card_title: 'Write plan', start_at: null, due_at: DUE_ISO },
    'Set this card to be due Sep 30 at 3:00 PM',
  ],
  [
    'card.due_set',
    { card_title: 'Write plan', start_at: DUE_ISO, due_at: null },
    'Set this card to start Sep 30 at 3:00 PM',
  ],
  ['card.due_removed', { card_title: 'Write plan' }, 'Removed the due date from this card'],
  ['card.due_completed', { card_title: 'Write plan' }, 'Marked the due date complete'],
  ['card.due_incompleted', { card_title: 'Write plan' }, 'Marked the due date incomplete'],
  [
    'card.label_added',
    { card_title: 'Write plan', label_id: 2, label_name: 'Urgent', label_color: 'red' },
    'Added the red Urgent label to this card',
  ],
  [
    'card.label_added',
    { card_title: 'Write plan', label_id: 2, label_name: '', label_color: 'green' },
    'Added the green label to this card',
  ],
  [
    'card.label_removed',
    { card_title: 'Write plan', label_id: 2, label_name: 'Urgent', label_color: 'red' },
    'Removed the red Urgent label from this card',
  ],

  [
    'label.created',
    { label_id: 2, label_name: 'Urgent', label_color: 'red', label_tone: 'normal' },
    'Created label Urgent',
  ],
  [
    'label.created',
    { label_id: 2, label_name: '', label_color: 'green', label_tone: 'normal' },
    'Created the green label',
  ],
  [
    'label.updated',
    {
      label_id: 2,
      label_name: 'Urgent',
      label_color: 'red',
      label_tone: 'bold',
      from_name: 'Hot',
      from_color: 'orange',
      from_tone: 'normal',
    },
    'Updated label Urgent (from Hot)',
  ],
  [
    'label.deleted',
    { label_id: 2, label_name: 'Urgent', label_color: 'red', card_count: 3 },
    'Deleted label Urgent (removed from 3 cards)',
  ],
  [
    'label.deleted',
    { label_id: 2, label_name: 'Urgent', label_color: 'red', card_count: 1 },
    'Deleted label Urgent (removed from 1 card)',
  ],
  [
    'label.deleted',
    { label_id: 2, label_name: 'Urgent', label_color: 'red' },
    'Deleted label Urgent (removed from 0 cards)',
  ],

  [
    'item.added',
    { item_id: 12, item_name: 'Draft' },
    'Added Draft to this card',
  ],
  [
    'item.renamed',
    { item_id: 12, from: 'Draft', item_name: 'Draft outline' },
    'Renamed Draft outline (from Draft)',
  ],
  [
    'item.deleted',
    { item_id: 12, item_name: 'Draft' },
    'Removed Draft from this card',
  ],
  ['item.checked', { item_id: 12, item_name: 'Draft' }, 'Completed Draft'],
  ['item.unchecked', { item_id: 12, item_name: 'Draft' }, 'Marked Draft incomplete'],
  [
    'item.due_set',
    { item_id: 12, item_name: 'Draft', due_at: ITEM_DUE_ISO },
    'Set Draft to be due Sep 30 at 12:00 PM',
  ],
  ['item.due_removed', { item_id: 12, item_name: 'Draft' }, 'Removed the due date from Draft'],
];

/** Section 3.8's two types with no sentence: the reorders, which travel over SSE only. */
const SILENT_TYPES = ['card.reordered', 'item.moved'];

describe('activitySentence', () => {
  it.each(SENTENCES)('renders %s as the Section 3.8 sentence', (type, data, expected) => {
    expect(activitySentence(row(type, data), { openCardId: OPEN_CARD_ID, now: NOW })).toBe(
      expected,
    );
  });

  it.each(SILENT_TYPES)('renders no sentence for %s', (type) => {
    expect(activitySentence(row(type, { card_title: 'Write plan' }), { now: NOW })).toBeNull();
  });

  it('renders no sentence for a type this client does not know', () => {
    expect(activitySentence(row('widget.frobnicated'), { now: NOW })).toBeNull();
  });

  it('covers every type of the closed ACTIVITY_TYPES list', () => {
    const rendered = new Set(SENTENCES.map(([type]) => type));
    for (const type of SILENT_TYPES) rendered.add(type);
    expect(rendered.size).toBe(41);
  });

  it('keeps the card title outside the open card', () => {
    const created = row('card.created', { card_title: 'Write plan', list_name: 'To Do' }, 99);
    expect(activitySentence(created, { openCardId: OPEN_CARD_ID, now: NOW })).toBe(
      'Added Write plan to To Do',
    );
    expect(activitySentence(created, { now: NOW })).toBe('Added Write plan to To Do');
  });

  it('never says "this card" when no card is open', () => {
    const created = row('card.created', { card_title: 'Write plan', list_name: 'To Do' });
    expect(activitySentence(created, { openCardId: null, now: NOW })).toBe(
      'Added Write plan to To Do',
    );
  });

  it('renders the board-feed-only deletion with the stored title', () => {
    const deleted = row('card.deleted', { card_title: 'Write plan', list_name: 'Done' }, null);
    expect(activitySentence(deleted, { openCardId: OPEN_CARD_ID, now: NOW })).toBe(
      'Deleted card Write plan from Done',
    );
  });

  it('drops the "(from …)" tail when the row carries no previous value', () => {
    expect(activitySentence(row('card.renamed', { to: 'Write plan' }), { now: NOW })).toBe(
      'Renamed this card',
    );
  });

  it('falls back to an empty name when the row is missing one, and to "now" when unset', () => {
    expect(activitySentence(row('list.archived'), { now: NOW })).toBe('Archived list ');
    expect(activitySentence(row('card.archived'))).toBe('Archived this card');
  });
});
