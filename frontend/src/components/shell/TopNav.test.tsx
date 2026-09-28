import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '@/store/uiStore';
import { userFixture } from '@/test/handlers';
import { server } from '@/test/server';
import { TopNav } from './TopNav';

function renderTopNav(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const app = (): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<TopNav user={userFixture} />} />
          <Route path="/login" element={<h1>Log in to continue</h1>} />
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

  it('shows the account identity and logs out to /login', async () => {
    const user = userEvent.setup();
    let loggedOut = false;
    server.use(
      http.post('/api/auth/logout', () => {
        loggedOut = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderTopNav();

    await user.click(screen.getByRole('button', { name: 'Account menu' }));

    expect(await screen.findByText(userFixture.email)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Log in to continue' })).toBeInTheDocument();
    expect(loggedOut).toBe(true);
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
