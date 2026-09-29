import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Activity, ActivityPage } from '@/api/types';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { ActivityFeed } from './ActivityFeed';

const BOARD_ID = 7;
const CARD_ID = 101;

function activity(id: number, type: string, data: Record<string, unknown>): Activity {
  return {
    id,
    board_id: BOARD_ID,
    card_id: CARD_ID,
    list_id: 11,
    type,
    data,
    board_version: id,
    created_at: '2026-09-24T17:00:00.000Z',
  };
}

/** One page of the board feed narrowed to this card, which is what the modal reads (Section 4.3). */
function serveFeed(items: Activity[]): void {
  server.use(
    http.get('/api/boards/:boardId/activity', () => {
      const page: ActivityPage = { items, next_before: null };
      return HttpResponse.json(page);
    }),
  );
}

describe('ActivityFeed', () => {
  it('renders the Section 3.8 sentence for each activity type', async () => {
    serveFeed([
      activity(9004, 'card.created', {
        card_title: 'Write launch announcement',
        list_name: 'To Do',
      }),
      activity(9003, 'card.moved', { from_list_name: 'To Do', to_list_name: 'Doing' }),
      activity(9002, 'card.label_added', { label_name: '', label_color: 'green' }),
      activity(9001, 'checklist.item_checked', { item_name: 'Wireframe', checklist_name: 'Steps' }),
      // A reorder travels over SSE only and has no sentence: the feed skips it (Section 3.8).
      activity(9000, 'checklist.item_moved', { item_name: 'Wireframe' }),
    ]);
    renderWithProviders(<ActivityFeed boardId={BOARD_ID} cardId={CARD_ID} />);
    await screen.findByText('Moved this card from To Do to Doing');

    // `card_title` reads "this card" in the open card's own feed (Section 2.6.3).
    expect(screen.getByText('Added this card to To Do')).toBeInTheDocument();
    expect(screen.getByText('Added the green label to this card')).toBeInTheDocument();
    expect(screen.getByText('Completed Wireframe on Steps')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('shows the relative time with the absolute one in its title', async () => {
    serveFeed([activity(9001, 'card.created', { card_title: 'Write', list_name: 'To Do' })]);
    renderWithProviders(<ActivityFeed boardId={BOARD_ID} cardId={CARD_ID} />);

    // Same substitution as above: this is the open card's own feed, so the title reads "this card".
    const row = await screen.findByText('Added this card to To Do');
    const time = row.parentElement?.querySelector('time');
    expect(time).toHaveAttribute('datetime', '2026-09-24T17:00:00.000Z');
    expect(time).toHaveAttribute('title');
  });

  it('says the feed is empty rather than showing nothing (Section 2.10)', async () => {
    serveFeed([]);
    renderWithProviders(<ActivityFeed boardId={BOARD_ID} cardId={CARD_ID} />);

    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
  });

  it('distinguishes a failed read from an empty feed', async () => {
    server.use(
      http.get('/api/boards/:boardId/activity', () => new HttpResponse(null, { status: 500 })),
    );
    renderWithProviders(<ActivityFeed boardId={BOARD_ID} cardId={CARD_ID} />);

    expect(await screen.findByText("Couldn't load activity.")).toBeInTheDocument();
    expect(screen.queryByText('No activity yet')).not.toBeInTheDocument();
  });
});
