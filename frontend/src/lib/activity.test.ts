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
  ['board.created', { board_name: 'Launch' }, 'created this board'],
  ['board.renamed', { from: 'Launch', to: 'Launch v2' }, 'renamed this board (from Launch)'],
  ['board.description_changed', {}, 'updated the description of this board'],
  [
    'board.visibility_changed',
    { from: 'private', to: 'workspace' },
    'changed the visibility of this board to workspace',
  ],
  [
    'board.background_changed',
    { background_type: 'color', background_value: 'green' },
    'changed the background of this board',
  ],
  ['board.closed', {}, 'closed this board'],
  ['board.reopened', {}, 're-opened this board'],

  [
    'member.added',
    { member_id: 7, member_name: 'Asha Rao', role: 'member' },
    'added Asha Rao to this board',
  ],
  [
    'member.removed',
    { member_id: 7, member_name: 'Asha Rao', self: false },
    'removed Asha Rao from this board',
  ],
  ['member.removed', { member_id: 7, member_name: 'Asha Rao', self: true }, 'left this board'],
  [
    'member.role_changed',
    { member_id: 7, member_name: 'Asha Rao', from_role: 'member', role: 'admin' },
    "changed Asha Rao's role to admin (from member)",
  ],

  ['list.created', { list_name: 'Doing' }, 'added list Doing to this board'],
  ['list.renamed', { from: 'Doing', to: 'In progress' }, 'renamed list In progress (from Doing)'],
  ['list.moved', { list_name: 'Done', index: 2 }, 'moved list Done'],
  [
    'list.moved_out',
    { list_name: 'Done', other_board_id: 9, other_board_name: 'Ops', index: 2 },
    'moved list Done to board Ops',
  ],
  [
    'list.moved_in',
    { list_name: 'Done', other_board_id: 7, other_board_name: 'Launch', index: 2 },
    'moved list Done from board Launch',
  ],
  [
    'list.copied',
    { list_name: 'Done (copy)', source_list_id: 4, source_list_name: 'Done', card_count: 5 },
    'copied list Done (copy) from Done',
  ],
  ['list.archived', { list_name: 'Done' }, 'archived list Done'],
  ['list.unarchived', { list_name: 'Done' }, 'sent list Done to the board'],
  ['list.color_changed', { list_name: 'Done', color: 'green' }, 'changed the color of list Done'],
  ['list.color_changed', { list_name: 'Done', color: null }, 'removed the color from list Done'],

  ['card.created', { card_title: 'Write plan', list_name: 'To Do' }, 'added this card to To Do'],
  [
    'card.copied',
    {
      card_title: 'Write plan',
      source_card_id: 41,
      source_card_title: 'Plan v1',
      source_list_name: 'Backlog',
      list_name: 'To Do',
    },
    'copied this card from Plan v1 in list Backlog',
  ],
  [
    'card.renamed',
    { from: 'Write plan', to: 'Write PLANNING.md' },
    'renamed this card (from Write plan)',
  ],
  [
    'card.description_changed',
    { card_title: 'Write plan' },
    'updated the description of this card',
  ],
  [
    'card.moved',
    {
      card_title: 'Write plan',
      from_list_id: 3,
      from_list_name: 'To Do',
      to_list_id: 4,
      to_list_name: 'Doing',
      index: 0,
    },
    'moved this card from To Do to Doing',
  ],
  [
    'card.moved_out',
    { card_title: 'Write plan', other_board_id: 9, other_board_name: 'Ops', list_name: 'Inbox' },
    'moved this card to board Ops',
  ],
  [
    'card.moved_in',
    { card_title: 'Write plan', other_board_id: 7, other_board_name: 'Launch', list_name: 'Inbox' },
    'moved this card from board Launch',
  ],
  ['card.archived', { card_title: 'Write plan' }, 'archived this card'],
  ['card.unarchived', { card_title: 'Write plan' }, 'sent this card to the board'],
  [
    'card.deleted',
    { card_title: 'Write plan', list_name: 'Done' },
    'deleted card Write plan from Done',
  ],
  [
    'card.due_set',
    { card_title: 'Write plan', start_at: null, due_at: DUE_ISO },
    'set this card to be due Sep 30 at 3:00 PM',
  ],
  [
    'card.due_set',
    { card_title: 'Write plan', start_at: DUE_ISO, due_at: null },
    'set this card to start Sep 30 at 3:00 PM',
  ],
  ['card.due_removed', { card_title: 'Write plan' }, 'removed the due date from this card'],
  ['card.due_completed', { card_title: 'Write plan' }, 'marked the due date complete'],
  ['card.due_incompleted', { card_title: 'Write plan' }, 'marked the due date incomplete'],
  [
    'card.cover_changed',
    { card_title: 'Write plan', cover_type: 'color', cover_value: 'green' },
    'updated the cover of this card',
  ],
  ['card.cover_removed', { card_title: 'Write plan' }, 'removed the cover from this card'],
  ['card.template_set', { card_title: 'Write plan' }, 'made this card a template'],
  [
    'card.template_unset',
    { card_title: 'Write plan' },
    'converted this card from a template to a normal card',
  ],
  [
    'card.label_added',
    { card_title: 'Write plan', label_id: 2, label_name: 'Urgent', label_color: 'red' },
    'added the red Urgent label to this card',
  ],
  [
    'card.label_added',
    { card_title: 'Write plan', label_id: 2, label_name: '', label_color: 'green' },
    'added the green label to this card',
  ],
  [
    'card.label_removed',
    { card_title: 'Write plan', label_id: 2, label_name: 'Urgent', label_color: 'red' },
    'removed the red Urgent label from this card',
  ],
  [
    'card.member_added',
    { card_title: 'Write plan', member_id: 7, member_name: 'Asha Rao', self: false },
    'added Asha Rao to this card',
  ],
  [
    'card.member_added',
    { card_title: 'Write plan', member_id: 1, member_name: 'Vivek', self: true },
    'joined this card',
  ],
  [
    'card.member_removed',
    { card_title: 'Write plan', member_id: 7, member_name: 'Asha Rao', self: false },
    'removed Asha Rao from this card',
  ],
  [
    'card.member_removed',
    { card_title: 'Write plan', member_id: 1, member_name: 'Vivek', self: true },
    'left this card',
  ],

  [
    'label.created',
    { label_id: 2, label_name: 'Urgent', label_color: 'red', label_tone: 'normal' },
    'created label Urgent',
  ],
  [
    'label.created',
    { label_id: 2, label_name: '', label_color: 'green', label_tone: 'normal' },
    'created the green label',
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
    'updated label Urgent (from Hot)',
  ],
  [
    'label.deleted',
    { label_id: 2, label_name: 'Urgent', label_color: 'red', card_count: 3 },
    'deleted label Urgent (removed from 3 cards)',
  ],
  [
    'label.deleted',
    { label_id: 2, label_name: 'Urgent', label_color: 'red', card_count: 1 },
    'deleted label Urgent (removed from 1 card)',
  ],
  [
    'label.deleted',
    { label_id: 2, label_name: 'Urgent', label_color: 'red' },
    'deleted label Urgent (removed from 0 cards)',
  ],

  [
    'checklist.added',
    { card_title: 'Write plan', checklist_id: 5, checklist_name: 'Steps' },
    'added checklist Steps to this card',
  ],
  [
    'checklist.renamed',
    { card_title: 'Write plan', checklist_id: 5, from: 'Steps', checklist_name: 'Launch steps' },
    'renamed checklist Launch steps (from Steps)',
  ],
  [
    'checklist.deleted',
    { card_title: 'Write plan', checklist_id: 5, checklist_name: 'Steps' },
    'removed checklist Steps from this card',
  ],
  [
    'checklist.item_added',
    { checklist_name: 'Steps', item_id: 12, item_name: 'Draft' },
    'added Draft to Steps',
  ],
  [
    'checklist.item_renamed',
    { checklist_name: 'Steps', item_id: 12, from: 'Draft', item_name: 'Draft outline' },
    'renamed Draft outline on Steps (from Draft)',
  ],
  [
    'checklist.item_deleted',
    { checklist_name: 'Steps', item_id: 12, item_name: 'Draft' },
    'removed Draft from Steps',
  ],
  [
    'checklist.item_checked',
    { checklist_name: 'Steps', item_id: 12, item_name: 'Draft' },
    'completed Draft on Steps',
  ],
  [
    'checklist.item_unchecked',
    { checklist_name: 'Steps', item_id: 12, item_name: 'Draft' },
    'marked Draft incomplete on Steps',
  ],
  [
    'checklist.item_due_set',
    { checklist_name: 'Steps', item_id: 12, item_name: 'Draft', due_at: ITEM_DUE_ISO },
    'set Draft on Steps to be due Sep 30 at 12:00 PM',
  ],
  [
    'checklist.item_due_removed',
    { checklist_name: 'Steps', item_id: 12, item_name: 'Draft' },
    'removed the due date from Draft on Steps',
  ],
  [
    'checklist.item_assigned',
    { checklist_name: 'Steps', item_name: 'Draft', member_id: 7, member_name: 'Asha Rao' },
    'assigned Draft on Steps to Asha Rao',
  ],
  [
    'checklist.item_unassigned',
    { checklist_name: 'Steps', item_name: 'Draft', member_id: 7, member_name: 'Asha Rao' },
    'unassigned Asha Rao from Draft on Steps',
  ],
  [
    'checklist.item_converted',
    { checklist_name: 'Steps', item_id: 12, item_name: 'Draft', new_card_id: 77 },
    'converted Draft to a card',
  ],

  [
    'attachment.added',
    { attachment_id: 3, attachment_name: 'photo.png', kind: 'upload' },
    'attached photo.png to this card',
  ],
  [
    'attachment.renamed',
    { attachment_id: 3, from: 'photo.png', attachment_name: 'Mock-up', kind: 'upload' },
    'renamed the attachment Mock-up (from photo.png)',
  ],
  [
    'attachment.deleted',
    { attachment_id: 3, attachment_name: 'photo.png', kind: 'upload' },
    'deleted the photo.png attachment from this card',
  ],

  ['comment.added', { comment_id: 9, body_preview: 'Looks good' }, 'commented on this card'],
  [
    'comment.edited',
    { comment_id: 9, body_preview: 'Looks good now' },
    'edited a comment on this card',
  ],
  [
    'comment.deleted',
    { comment_id: 9, body_preview: 'Looks good' },
    'deleted a comment from this card',
  ],
];

/** Section 3.8's five types with no sentence: three reorders and the two reserved watch rows. */
const SILENT_TYPES = [
  'card.reordered',
  'checklist.moved',
  'checklist.item_moved',
  'card.watched',
  'card.unwatched',
];

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
    expect(rendered.size).toBe(68);
  });

  it('keeps the card title outside the open card, and drops the actor prefix', () => {
    const created = row('card.created', { card_title: 'Write plan', list_name: 'To Do' }, 99);
    expect(activitySentence(created, { openCardId: OPEN_CARD_ID, now: NOW })).toBe(
      'added Write plan to To Do',
    );
    expect(activitySentence(created, { now: NOW })).toBe('added Write plan to To Do');
  });

  it('never says "this card" when no card is open', () => {
    const copied = row('card.copied', {
      card_title: 'Write plan',
      source_card_title: 'Plan v1',
      source_list_name: 'Backlog',
    });
    expect(activitySentence(copied, { openCardId: null, now: NOW })).toBe(
      'copied Write plan from Plan v1 in list Backlog',
    );
  });

  it('renders the board-feed-only deletion with the stored title', () => {
    const deleted = row('card.deleted', { card_title: 'Write plan', list_name: 'Done' }, null);
    expect(activitySentence(deleted, { openCardId: OPEN_CARD_ID, now: NOW })).toBe(
      'deleted card Write plan from Done',
    );
  });

  it('drops the "(from …)" tail when the row carries no previous value', () => {
    expect(activitySentence(row('card.renamed', { to: 'Write plan' }), { now: NOW })).toBe(
      'renamed this card',
    );
  });

  it('falls back to an empty name when the row is missing one, and to "now" when unset', () => {
    expect(activitySentence(row('list.archived'), { now: NOW })).toBe('archived list ');
    expect(activitySentence(row('card.archived'))).toBe('archived this card');
  });
});
