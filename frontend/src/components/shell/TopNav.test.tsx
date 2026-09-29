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
    expect(screen.getByRole('button', { name: /Create board/ })).toBeInTheDocument();
    // M5 made "Create card" real; what the row then does is `CreateMenuPopover`'s own test.
    expect(screen.getByRole('button', { name: /Create card/ })).toBeInTheDocument();
  });

  it('lists the recent boards behind the Recent button', async () => {
    const user = userEvent.setup();
    renderTopNav();

    await user.click(screen.getByRole('button', { name: 'Recent' }));

    expect(useUiStore.getState().openPopover?.kind).toBe('boards');
    expect(await screen.findByRole('button', { name: 'Roadmap' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unstar Roadmap' })).toBeInTheDocument();
  });
});
