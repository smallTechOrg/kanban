import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Activity, CardFeed, FeedItem } from '@/api/types';
import { commentFixture, publicUserFixture } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { useUiStore } from '@/store/uiStore';
import { ActivityFeed } from './ActivityFeed';

const BOARD_ID = 7;
const CARD_ID = 101;

function activity(id: number, type: string, data: Record<string, unknown>): FeedItem {
  const row: Activity = {
    id,
    board_id: BOARD_ID,
    card_id: CARD_ID,
    list_id: 11,
    user: publicUserFixture,
    type,
    data,
    board_version: id,
    created_at: '2026-09-24T17:00:00.000Z',
  };
  return { kind: 'activity', activity: row };
}

/** One page of a feed the test wrote itself: `details=0` keeps the comments, as the API does. */
function serveFeed(items: FeedItem[]): void {
  server.use(
    http.get('/api/cards/:cardId/feed', ({ request }) => {
      const details = new URL(request.url).searchParams.get('details');
      const page: CardFeed = {
        items: details === '0' ? items.filter((row) => row.kind === 'comment') : items,
        next_before: null,
      };
      return HttpResponse.json(page);
    }),
  );
}

/** The store is a singleton: "Show details" must not leak into the next test. */
afterEach(() => useUiStore.getState().setActivityDetails(false));

function showDetails(): void {
  useUiStore.getState().setActivityDetails(true);
}

describe('ActivityFeed', () => {
  it('renders the Section 3.8 sentence for each activity type', async () => {
    showDetails();
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
    await screen.findByText(/moved this card from To Do to Doing/);

    // `card_title` reads "this card" in the open card's own feed (Section 2.6.3).
    expect(screen.getByText(/added this card to To Do/)).toBeInTheDocument();
    expect(screen.getByText(/added the green label/)).toBeInTheDocument();
    expect(screen.getByText(/completed Wireframe on Steps/)).toBeInTheDocument();
    expect(screen.queryByText(/Wireframe on/)).not.toHaveTextContent('moved');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('renders a comment as Markdown with Edit and Delete for its author', async () => {
    serveFeed([{ kind: 'comment', comment: { ...commentFixture, body: 'Ship **it**' } }]);
    renderWithProviders(<ActivityFeed boardId={BOARD_ID} cardId={CARD_ID} />);

    expect((await screen.findByText('it')).tagName).toBe('STRONG');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('shows the empty copy of Section 2.10 while details are hidden', async () => {
    serveFeed([activity(9001, 'card.created', { card_title: 'Write', list_name: 'To Do' })]);
    renderWithProviders(<ActivityFeed boardId={BOARD_ID} cardId={CARD_ID} />);

    // The store defaults to hidden, so the activity row above is filtered out server-side.
    expect(await screen.findByText('No comments yet')).toBeInTheDocument();
  });

  it('opens the editor on Edit and puts the comment body in it', async () => {
    const user = userEvent.setup();
    serveFeed([{ kind: 'comment', comment: commentFixture }]);
    renderWithProviders(<ActivityFeed boardId={BOARD_ID} cardId={CARD_ID} />);

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: 'Edit comment' })).toHaveValue(commentFixture.body);
  });

  it('distinguishes a failed read from an empty feed', async () => {
    server.use(http.get('/api/cards/:cardId/feed', () => new HttpResponse(null, { status: 500 })));
    renderWithProviders(<ActivityFeed boardId={BOARD_ID} cardId={CARD_ID} />);

    expect(await screen.findByText("Couldn't load activity.")).toBeInTheDocument();
    expect(screen.queryByText('No comments yet')).not.toBeInTheDocument();
  });
});
