import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Board } from '@/api/types';
import { useUiStore } from '@/store/uiStore';
import { boardPayloadFixture, makeBoardSummary } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { BoardPage } from './BoardPage';

const BOARD_ID = 7;

/** Answers `GET /api/boards/7` with a variation on the fixture payload. */
function servePayload(payload: Board): void {
  server.use(http.get('/api/boards/:boardId', () => HttpResponse.json(payload)));
}

function renderBoard(path = `/b/${BOARD_ID}`): void {
  renderWithProviders(
    <Routes>
      <Route path="/b/:boardId" element={<BoardPage />} />
      <Route path="/" element={<p>Home page</p>} />
    </Routes>,
    path,
  );
}

describe('BoardPage', () => {
  beforeEach(() => {
    useUiStore.setState({ composer: null, openPopover: null });
  });

  it('renders the header, the columns and their cards from the payload', async () => {
    renderBoard();

    // The trigger's accessible name carries the board name, so the `h1` announces the board
    // rather than the literal string "Board name" (WCAG 2.5.3), the same shape the list
    // headers below use.
    expect(
      await screen.findByRole('button', { name: 'Rename board Website relaunch' }),
    ).toHaveTextContent('Website relaunch');
    expect(screen.getByRole('button', { name: 'Rename list To Do' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename list Doing' })).toBeInTheDocument();
    expect(screen.getByText('Write launch announcement')).toBeInTheDocument();
    expect(screen.getByText('Migrate DNS')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add another list' })).toBeInTheDocument();
  });

  it('titles the document after the board', async () => {
    renderBoard();

    await screen.findByRole('button', { name: 'Rename board Website relaunch' });

    expect(document.title).toBe('Website relaunch | Kan Ban');
  });

  it('renders the board controls of Section 2.3.1', async () => {
    renderBoard();

    expect(await screen.findByRole('button', { name: 'Filter' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Show menu' })).toBeEnabled();
  });

  it('opens the list composer on a board with no lists', async () => {
    servePayload({ ...boardPayloadFixture, lists: [], cards: [] });
    renderBoard();

    const field = await screen.findByRole('textbox', { name: 'List title' });

    expect(field).toHaveAttribute('placeholder', 'Enter list title…');
    expect(screen.queryByRole('button', { name: 'Add another list' })).not.toBeInTheDocument();
  });

  it('renders the closed-board screen instead of the board', async () => {
    servePayload({
      ...boardPayloadFixture,
      board: makeBoardSummary({ id: BOARD_ID, name: 'Website relaunch', is_closed: true }),
    });
    renderBoard();

    expect(
      await screen.findByRole('heading', { name: 'Website relaunch is closed' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename list To Do' })).not.toBeInTheDocument();
  });

  it('shows the 404 copy when the board cannot be loaded', async () => {
    server.use(
      http.get('/api/boards/:boardId', () =>
        HttpResponse.json(
          { error: { code: 'not_found', message: 'Board not found' } },
          {
            status: 404,
          },
        ),
      ),
    );
    renderBoard();

    expect(await screen.findByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
  });

  it('shows the 404 copy for an id that cannot be a board', () => {
    renderBoard('/b/nope');

    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
  });
});
