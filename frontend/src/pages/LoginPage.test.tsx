import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { metaFixture } from '@/test/handlers';
import { server } from '@/test/server';
import { LoginPage } from './LoginPage';

/** The login page on a router that can show where a successful login landed. */
function renderLoginPage(entry = '/login'): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const app = (): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<h1>Boards</h1>} />
          <Route path="/w/settings" element={<h1>Workspace settings</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(app());
}

function loginError(status: number, code: string): void {
  server.use(
    http.post('/api/auth/login', () =>
      HttpResponse.json({ error: { code, message: 'nope', request_id: 'req_1' } }, { status }),
    ),
  );
}

describe('LoginPage', () => {
  it('reports both fields before sending anything to the server', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Enter your email or username.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
  });

  it('maps a 401 to the copy of Section 2.1.3', async () => {
    const user = userEvent.setup();
    loginError(401, 'unauthorized');
    renderLoginPage();

    await user.type(screen.getByLabelText('Email or username'), 'vivek');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Incorrect email/username or password.',
    );
  });

  it('maps a 429 to the throttling copy', async () => {
    const user = userEvent.setup();
    loginError(429, 'rate_limited');
    renderLoginPage();

    await user.type(screen.getByLabelText('Email or username'), 'vivek');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many attempts/);
  });

  it('navigates to the next parameter the shell guard set', async () => {
    const user = userEvent.setup();
    renderLoginPage('/login?next=%2Fw%2Fsettings');

    await user.type(screen.getByLabelText('Email or username'), 'vivek');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('heading', { name: 'Workspace settings' })).toBeInTheDocument();
  });

  it('prefills the admin username in single-user mode', async () => {
    server.use(
      http.get('/api/meta', () =>
        HttpResponse.json({ ...metaFixture, single_user: true, admin_username: 'admin' }),
      ),
    );
    renderLoginPage();

    expect(await screen.findByDisplayValue('admin')).toBeInTheDocument();
  });
});
