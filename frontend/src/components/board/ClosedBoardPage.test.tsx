import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeBoardSummary } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { ClosedBoardPage } from './ClosedBoardPage';

/** Records the writes the card makes, so the tests assert the request, not the hook. */
function recordCalls(): string[] {
  const calls: string[] = [];
  server.use(
    http.post('/api/boards/:boardId/reopen', ({ params }) => {
      calls.push(`REOPEN ${String(params['boardId'])}`);
      const item = makeBoardSummary({ id: Number(params['boardId']), version: 3 });
      return HttpResponse.json({ item, board_version: item.version });
    }),
    http.delete('/api/boards/:boardId', ({ params }) => {
      calls.push(`DELETE ${String(params['boardId'])}`);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

function renderClosedBoard(): void {
  const board = makeBoardSummary({ id: 9, name: 'Trip 2027', is_closed: true });
  renderWithProviders(
    <Routes>
      <Route path="/b/:boardId" element={<ClosedBoardPage board={board} />} />
      <Route path="/" element={<p>Home page</p>} />
    </Routes>,
    '/b/9',
  );
}

describe('ClosedBoardPage', () => {
  it('names the closed board and offers both actions', () => {
    renderClosedBoard();

    expect(screen.getByRole('heading', { name: 'Trip 2027 is closed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen board' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete board' })).toBeInTheDocument();
  });

  it('reopens the board in place, without leaving the page', async () => {
    const user = userEvent.setup();
    const calls = recordCalls();
    renderClosedBoard();

    await user.click(screen.getByRole('button', { name: 'Reopen board' }));

    expect(calls).toEqual(['REOPEN 9']);
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
  });

  it('deletes only after the confirmation, then goes back to the boards', async () => {
    const user = userEvent.setup();
    const calls = recordCalls();
    renderClosedBoard();

    await user.click(screen.getByRole('button', { name: 'Delete board' }));
    expect(await screen.findByText('Delete board?')).toBeInTheDocument();
    expect(calls).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(calls).toEqual(['DELETE 9']);
  });

  it('goes back to the boards from the link', async () => {
    const user = userEvent.setup();
    renderClosedBoard();

    await user.click(screen.getByRole('button', { name: 'Back to boards' }));

    expect(screen.getByText('Home page')).toBeInTheDocument();
  });
});
