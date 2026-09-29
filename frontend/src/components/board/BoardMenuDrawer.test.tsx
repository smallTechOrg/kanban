import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeBoardSummary } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { BoardMenuDrawer } from './BoardMenuDrawer';

const BOARD_ID = 7;

interface Handles {
  onClose: () => void;
  onSearchCards: () => void;
}

function renderDrawer(): Handles {
  const handles: Handles = { onClose: vi.fn(), onSearchCards: vi.fn() };
  renderWithProviders(
    <Routes>
      <Route
        path="/b/:boardId"
        element={
          <BoardMenuDrawer
            boardId={BOARD_ID}
            onClose={handles.onClose}
            onSearchCards={handles.onSearchCards}
          />
        }
      />
      <Route path="/" element={<p>Home page</p>} />
    </Routes>,
    `/b/${BOARD_ID}`,
  );
  return handles;
}

describe('BoardMenuDrawer', () => {
  it('opens on the root menu with the rows of Section 2.3.4', async () => {
    renderDrawer();

    expect(await screen.findByRole('heading', { name: 'Menu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About this board' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Archived items' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Activity' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Close board…' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Labels' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeEnabled();
    // M5 made "Change background" real; no row is a scope guard any more (Section 7.2).
    expect(screen.getByRole('button', { name: 'Change background' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('pushes the About panel and pops back to the menu', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(await screen.findByRole('button', { name: 'About this board' }));

    expect(screen.getByRole('heading', { name: 'About this board' })).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archived items' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByRole('heading', { name: 'Menu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archived items' })).toBeInTheDocument();
  });

  it('pushes the Labels panel, which edits the board labels through the shared form', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(await screen.findByRole('button', { name: 'Labels' }));

    expect(screen.getByRole('heading', { name: 'Labels' })).toBeInTheDocument();
    // The six seeded labels are unnamed, so a row reads as its colour key (Section 2.6.5).
    await user.click(screen.getByRole('button', { name: 'Edit label green' }));

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Create a new label' })).toBeInTheDocument();
  });

  it('pushes the Settings panel with the covers toggle', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(await screen.findByRole('button', { name: 'Settings' }));

    expect(screen.getByLabelText('Card covers enabled')).toBeChecked();

    await user.click(screen.getByLabelText('Card covers enabled'));
    expect(screen.getByLabelText('Card covers enabled')).not.toBeChecked();
  });

  it('pushes the activity feed, whose rows are sentences from lib/activity.ts', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(await screen.findByRole('button', { name: 'Activity' }));

    const feed = await screen.findByRole('list');
    expect(feed).toHaveTextContent('Renamed this board (from Website)');
    expect(feed).toHaveTextContent('Added Write launch announcement to To Do');
  });

  it('pushes the archived items panel', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/boards/:boardId/archived', () =>
        HttpResponse.json({ items: [], next_before: null }),
      ),
    );
    renderDrawer();

    await user.click(await screen.findByRole('button', { name: 'Archived items' }));

    expect(await screen.findByText('No archived cards')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Archived items' })).toBeInTheDocument();
  });

  it('closes the board only after the confirm, then leaves for the boards page', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    server.use(
      http.post('/api/boards/:boardId/close', ({ params }) => {
        calls.push(`POST /boards/${String(params['boardId'])}/close`);
        return HttpResponse.json({
          item: makeBoardSummary({ id: BOARD_ID, is_closed: true }),
          board_version: 2,
        });
      }),
    );
    const handles = renderDrawer();

    await user.click(await screen.findByRole('button', { name: 'Close board…' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Close board?')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'You can find and reopen closed boards at the bottom of your boards page.',
      ),
    ).toBeInTheDocument();
    expect(calls).toEqual([]);

    // The popover's own X is also named "Close", so the danger button is found by its text.
    await user.click(within(dialog).getByText('Close'));

    await waitFor(() => {
      expect(calls).toEqual(['POST /boards/7/close']);
    });
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(handles.onClose).toHaveBeenCalled();
  });

  it('opens the filter on "Search cards" and closes from the X', async () => {
    const user = userEvent.setup();
    const handles = renderDrawer();

    await user.click(await screen.findByRole('button', { name: 'Search cards' }));
    expect(handles.onSearchCards).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(handles.onClose).toHaveBeenCalledTimes(1);
  });
});
