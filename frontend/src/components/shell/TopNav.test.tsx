import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '@/store/uiStore';
import { TopNav } from './TopNav';

function renderTopNav(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const app = (): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<TopNav />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(app());
}

describe('TopNav', () => {
  beforeEach(() => {
    // The popover store is module scope: one test must not leak into the next.
    useUiStore.getState().setOpenPopover(null);
  });

  it('opens the Create menu with both rows of Section 2.1.2', async () => {
    const user = userEvent.setup();
    renderTopNav();

    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create space/ })).toBeInTheDocument();
    // M5 made "Create card" real; what the row then does is `CreateMenuPopover`'s own test.
    expect(screen.getByRole('button', { name: /Create card/ })).toBeInTheDocument();
  });

  it('offers no Recent or Starred dropdown', () => {
    renderTopNav();

    // One person's boards are one list, so "Boards" goes home and that is the whole nav.
    expect(screen.queryByRole('button', { name: 'Recent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Starred' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spaces' })).toBeInTheDocument();
  });
});
