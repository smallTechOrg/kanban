import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { ProfileInput } from '@/api/auth';
import { userFixture } from '@/test/handlers';
import { server } from '@/test/server';
import { ProfileModal } from './ProfileModal';

/**
 * `ui/Modal` moves focus to its Close button a tick after mount; typing before that lands
 * on the button instead of the field, so every test waits for focus to settle first.
 */
async function renderProfileModal(
  onClose = vi.fn(),
): Promise<{ onClose: ReturnType<typeof vi.fn> }> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const app = (): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <ProfileModal user={userFixture} onClose={onClose} />
    </QueryClientProvider>
  );
  render(app());
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus());
  return { onClose };
}

describe('ProfileModal', () => {
  it('sends the changed fields to PATCH /api/auth/me and closes', async () => {
    const user = userEvent.setup();
    let patch: ProfileInput | undefined;
    server.use(
      http.patch('/api/auth/me', async ({ request }) => {
        patch = (await request.json()) as ProfileInput;
        return HttpResponse.json({ ...userFixture, full_name: 'Vivek S' });
      }),
    );
    const { onClose } = await renderProfileModal();

    const name = screen.getByLabelText('Full name');
    await user.clear(name);
    await user.type(name, 'Vivek S');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patch).toEqual({ full_name: 'Vivek S' });
  });

  it('saves the avatar colour chosen from the /api/meta swatches', async () => {
    const user = userEvent.setup();
    let patch: ProfileInput | undefined;
    server.use(
      http.patch('/api/auth/me', async ({ request }) => {
        patch = (await request.json()) as ProfileInput;
        return HttpResponse.json(userFixture);
      }),
    );
    await renderProfileModal();

    await user.click(await screen.findByRole('button', { name: 'Avatar colour 3' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(patch).toEqual({ avatar_color: 'var(--danger)' }));
  });

  it('requires the current password before a new one and never sends the form', async () => {
    const user = userEvent.setup();
    let called = false;
    server.use(
      http.patch('/api/auth/me', () => {
        called = true;
        return HttpResponse.json(userFixture);
      }),
    );
    await renderProfileModal();

    await user.type(screen.getByLabelText('New password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter your current password.')).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('puts a 400 under the current password field', async () => {
    const user = userEvent.setup();
    server.use(
      http.patch('/api/auth/me', () =>
        HttpResponse.json(
          { error: { code: 'bad_request', message: 'wrong', request_id: 'req_1' } },
          { status: 400 },
        ),
      ),
    );
    await renderProfileModal();

    await user.type(screen.getByLabelText('Current password'), 'nope-nope');
    await user.type(screen.getByLabelText('New password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
  });
});
