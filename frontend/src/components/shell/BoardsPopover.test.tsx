import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { boardGroupsFixture } from '@/test/handlers';
import { BoardsPopover } from './BoardsPopover';

const A_BOARD = 'Roadmap';
const ANOTHER = 'Website relaunch';

function renderPopover(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const anchor = document.createElement('button');
  document.body.append(anchor);
  const app = (): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <BoardsPopover anchor={anchor} onClose={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(app());
}

describe('BoardsPopover', () => {
  it('lists every board under one title', async () => {
    renderPopover();

    expect(await screen.findByRole('button', { name: A_BOARD })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ANOTHER })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Spaces' })).toBeInTheDocument();

    // There is no Recent or Starred group to tell apart, and no star to toggle.
    expect(screen.queryByRole('heading', { name: 'Recent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Starred' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Star ${A_BOARD}` })).not.toBeInTheDocument();
  });

  it('narrows the list by the filter input', async () => {
    const user = userEvent.setup();
    renderPopover();

    await screen.findByRole('button', { name: A_BOARD });
    await user.type(screen.getByRole('textbox', { name: 'Filter spaces' }), 'road');

    expect(screen.getByRole('button', { name: A_BOARD })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ANOTHER })).not.toBeInTheDocument();
  });

  it('says so when no board matches', async () => {
    const user = userEvent.setup();
    renderPopover();

    await screen.findByRole('button', { name: A_BOARD });
    await user.type(screen.getByRole('textbox', { name: 'Filter spaces' }), 'zzz');

    expect(screen.getByText('No spaces yet')).toBeInTheDocument();
    expect(boardGroupsFixture.all.length).toBeGreaterThan(0);
  });
});
