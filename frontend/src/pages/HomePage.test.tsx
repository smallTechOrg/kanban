import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { BoardGroups } from '@/api/types';
import { boardGroupsFixture, closedBoardFixture, makeBoardSummary } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { HomePage } from './HomePage';

const EMPTY_GROUPS: BoardGroups = { starred: [], recent: [], all: [] };

function serveGroups(groups: BoardGroups): void {
  server.use(
    http.get('/api/boards', ({ request }) =>
      new URL(request.url).searchParams.get('closed') === '1'
        ? HttpResponse.json({ closed: [closedBoardFixture] })
        : HttpResponse.json(groups),
    ),
  );
}

/** The heading's own section, so "Roadmap" is asserted where it belongs. */
function section(name: RegExp): HTMLElement {
  const heading = screen.getByRole('heading', { name });
  const owner = heading.closest('section');
  if (owner === null) throw new Error(`No section around the ${String(name)} heading`);
  return owner;
}

describe('HomePage', () => {
  it('renders Starred boards, Recently viewed and the workspace in that order', async () => {
    renderWithProviders(<HomePage />);

    // The workspaces heading renders while the query is still in flight, so wait for the data.
    await screen.findByRole('heading', { name: 'Starred boards' });
    const headings = screen.getAllByRole('heading', {
      name: /Starred boards|Recently viewed|Your workspaces/,
    });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Starred boards',
      'Recently viewed',
      'Your workspaces',
    ]);

    expect(within(section(/Starred boards/)).getByRole('link', { name: 'Roadmap' })).toBeVisible();
    expect(within(section(/Recently viewed/)).getAllByRole('link')).toHaveLength(
      boardGroupsFixture.recent.length,
    );
    expect(within(section(/Your workspaces/)).getAllByRole('link')).toHaveLength(
      boardGroupsFixture.all.length,
    );
    expect(screen.getByRole('button', { name: 'Create new board' })).toBeVisible();
  });

  it('hides the starred section and explains the empty grid when there are no boards', async () => {
    serveGroups(EMPTY_GROUPS);
    renderWithProviders(<HomePage />);

    expect(await screen.findByText(/Boards are where work gets done/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Starred boards' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recently viewed' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create new board' })).toBeVisible();
  });

  it('shows at most four recently viewed tiles', async () => {
    serveGroups({
      ...EMPTY_GROUPS,
      recent: [1, 2, 3, 4, 5].map((id) => makeBoardSummary({ id, name: `Board ${String(id)}` })),
    });
    renderWithProviders(<HomePage />);

    await screen.findByRole('heading', { name: 'Recently viewed' });

    expect(within(section(/Recently viewed/)).getAllByRole('link')).toHaveLength(4);
  });

  it('opens the closed boards modal from the section footer', async () => {
    const user = userEvent.setup();
    renderWithProviders(<HomePage />);

    await user.click(await screen.findByRole('button', { name: 'View all closed boards' }));

    const dialog = await screen.findByRole('dialog', { name: 'Closed boards' });
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

    expect(await screen.findByText("Couldn't load your boards.")).toBeInTheDocument();
    expect(screen.queryByText(/Boards are where work gets done/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(/Boards are where work gets done/)).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your boards.")).not.toBeInTheDocument();
  });
});
