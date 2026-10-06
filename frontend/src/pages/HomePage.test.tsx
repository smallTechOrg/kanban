import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { BoardGroups } from '@/api/types';
import { boardGroupsFixture, closedBoardFixture } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { HomePage } from './HomePage';

const EMPTY_GROUPS: BoardGroups = { all: [] };

function serveGroups(groups: BoardGroups): void {
  server.use(
    http.get('/api/boards', ({ request }) =>
      new URL(request.url).searchParams.get('closed') === '1'
        ? HttpResponse.json({ closed: [closedBoardFixture] })
        : HttpResponse.json(groups),
    ),
  );
}

describe('HomePage', () => {
  it('renders every board in one list, with no Starred or Recent group', async () => {
    renderWithProviders(<HomePage />);

    const links = await screen.findAllByRole('link');
    expect(links).toHaveLength(boardGroupsFixture.all.length);
    expect(screen.getByRole('button', { name: 'Create new space' })).toBeVisible();

    for (const name of ['Starred boards', 'Recently viewed', 'Your boards']) {
      expect(screen.queryByRole('heading', { name })).not.toBeInTheDocument();
    }
  });

  it('greets the reader instead of labelling the list', async () => {
    renderWithProviders(<HomePage />);

    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.textContent).toMatch(/^Good (morning|afternoon|evening)$/);
  });

  it('says what the app is, under the greeting', async () => {
    renderWithProviders(<HomePage />);

    // Section 2.2: the tagline and the three points are the only place an install with no
    // sign-up gets to explain itself.
    expect(await screen.findByText("Everything you're on, in one place.")).toBeInTheDocument();
    expect(screen.getByText(/A space for the shopping/)).toBeInTheDocument();
    for (const point of [
      'A space for each part of life',
      'Tick things off',
      'Nothing to sign in to',
    ]) {
      expect(screen.getByText(point)).toBeInTheDocument();
    }
  });

  it('explains the empty grid when there are no boards', async () => {
    serveGroups(EMPTY_GROUPS);
    renderWithProviders(<HomePage />);

    expect(await screen.findByText(/Spaces are where everything you are keeping track of/)).
      toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create new space' })).toBeVisible();
  });

  it('opens the closed boards modal from the footer', async () => {
    const user = userEvent.setup();
    renderWithProviders(<HomePage />);

    await user.click(await screen.findByRole('button', { name: 'View all closed spaces' }));

    const dialog = await screen.findByRole('dialog', { name: 'Closed spaces' });
    expect(within(dialog).getByText(closedBoardFixture.name)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Reopen' })).toBeVisible();
  });

  it('offers a retry when the boards request fails, instead of the first-board blurb', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    server.use(
      http.get('/api/boards', ({ request }) => {
        if (new URL(request.url).searchParams.get('closed') === '1') {
          return HttpResponse.json({ closed: [] });
        }
        attempts += 1;
        return attempts === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json(EMPTY_GROUPS);
      }),
    );
    renderWithProviders(<HomePage />);

    expect(await screen.findByText("Couldn't load your spaces.")).toBeInTheDocument();
    expect(screen.queryByText(/Spaces are where everything/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(/Spaces are where everything/)).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your spaces.")).not.toBeInTheDocument();
  });
});
