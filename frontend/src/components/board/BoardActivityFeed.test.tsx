import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Activity } from '@/api/types';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { BoardActivityFeed } from './BoardActivityFeed';

const BOARD_ID = 7;

/** One page of the board feed, so the "Load more" sentinel never appears (Section 4.3). */
function serveActivity(items: Activity[]): void {
  server.use(
    http.get('/api/boards/:boardId/activity', () =>
      HttpResponse.json({ items, next_before: null }),
    ),
  );
}

describe('BoardActivityFeed', () => {
  it('renders one row per activity, the card rows as links to the card', async () => {
    renderWithProviders(<BoardActivityFeed boardId={BOARD_ID} />);

    // The board-level row is plain text; the card row links to /b/7/c/101 (Section 2.3.4).
    expect(await screen.findByText(/Renamed this space \(from Website\)/)).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/b/7/c/101');
  });

  it('says the feed is empty rather than showing nothing (Section 2.10)', async () => {
    serveActivity([]);
    renderWithProviders(<BoardActivityFeed boardId={BOARD_ID} />);

    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
  });

  it('distinguishes a failed read from an empty feed', async () => {
    server.use(
      http.get('/api/boards/:boardId/activity', () => new HttpResponse(null, { status: 500 })),
    );
    renderWithProviders(<BoardActivityFeed boardId={BOARD_ID} />);

    expect(await screen.findByText("Couldn't load activity.")).toBeInTheDocument();
    expect(screen.queryByText('No activity yet')).not.toBeInTheDocument();
  });
});
