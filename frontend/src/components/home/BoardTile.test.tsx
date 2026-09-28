import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeBoardSummary } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { BoardTile } from './BoardTile';

const GRADIENTS = { 'gradient-ocean': 'linear-gradient(135deg, red, blue)' };

/** Records the star writes the tile makes, so the test asserts the request, not the hook. */
function recordStarCalls(): string[] {
  const calls: string[] = [];
  server.use(
    http.put('/api/boards/:boardId/star', ({ params }) => {
      calls.push(`PUT ${String(params['boardId'])}`);
      return HttpResponse.json({ is_starred: true });
    }),
    http.delete('/api/boards/:boardId/star', ({ params }) => {
      calls.push(`DELETE ${String(params['boardId'])}`);
      return HttpResponse.json({ is_starred: false });
    }),
  );
  return calls;
}

function renderTile(isStarred: boolean): void {
  const board = makeBoardSummary({ id: 7, name: 'Website relaunch', is_starred: isStarred });
  renderWithProviders(
    <Routes>
      <Route path="/" element={<BoardTile board={board} gradients={GRADIENTS} />} />
      <Route path="/b/:boardId" element={<p>Board page</p>} />
    </Routes>,
  );
}

describe('BoardTile', () => {
  it('opens the board when the tile is clicked', async () => {
    const user = userEvent.setup();
    renderTile(false);

    await user.click(screen.getByRole('link', { name: 'Website relaunch' }));

    expect(screen.getByText('Board page')).toBeInTheDocument();
  });

  it('stars an unstarred board without leaving the home page', async () => {
    const user = userEvent.setup();
    const calls = recordStarCalls();
    renderTile(false);

    await user.click(screen.getByRole('button', { name: 'Star board' }));

    expect(calls).toEqual(['PUT 7']);
    expect(screen.queryByText('Board page')).not.toBeInTheDocument();
  });

  it('unstars a starred board', async () => {
    const user = userEvent.setup();
    const calls = recordStarCalls();
    renderTile(true);

    await user.click(screen.getByRole('button', { name: 'Unstar board' }));

    expect(calls).toEqual(['DELETE 7']);
  });
});
