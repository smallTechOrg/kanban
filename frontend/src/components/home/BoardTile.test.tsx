import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeBoardSummary } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { BoardTile } from './BoardTile';

const GRADIENTS = { 'gradient-ocean': 'linear-gradient(135deg, red, blue)' };

function renderTile(): void {
  const board = makeBoardSummary({ id: 7, name: 'Website relaunch' });
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
    renderTile();

    await user.click(screen.getByRole('link', { name: 'Website relaunch' }));

    expect(screen.getByText('Board page')).toBeInTheDocument();
  });

  it('is a link and nothing else: there is no star to toggle', () => {
    renderTile();

    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
