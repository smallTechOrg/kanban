import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Link,
  MemoryRouter,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeCardDetail } from '@/test/handlers';
import { server } from '@/test/server';
import { CardDetailModal } from './CardDetailModal';

const BOARD_ID = 7;
const CARD_ID = 101;
const CARD_URL = `/b/${String(BOARD_ID)}/c/${String(CARD_ID)}`;
const BOARD_URL = `/b/${String(BOARD_ID)}`;

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

/** Stands in for `BoardPage`: the tile the modal opens from, and the `<Outlet>` it renders in. */
function BoardStub(): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <p data-testid="path">{location.pathname}</p>
      <Link to={CARD_URL}>Write launch announcement</Link>
      <button type="button" onClick={() => navigate(-1)}>
        Browser back
      </button>
      <Outlet />
    </div>
  );
}

function renderAt(route: string): void {
  render(
    <QueryClientProvider client={testQueryClient()}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="b/:boardId" element={<BoardStub />}>
            <Route path="c/:cardId" element={<CardDetailModal />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The dialog, once `GET /api/cards/101` has filled its sections in. */
async function openModal(): Promise<HTMLElement> {
  const dialog = await screen.findByRole('dialog');
  await screen.findByRole('button', { name: 'Add a more detailed description…' });
  return dialog;
}

describe('CardDetailModal', () => {
  it('closes the open editor on Escape and only closes the modal on the second', async () => {
    const user = userEvent.setup();
    renderAt(CARD_URL);
    await openModal();

    await user.click(screen.getByRole('button', { name: 'Add a more detailed description…' }));
    const editor = screen.getByRole('textbox', { name: 'Description' });
    await waitFor(() => expect(editor).toHaveFocus());

    await user.keyboard('{Escape}');

    // The editor consumed the key: it is gone and the card is still open.
    expect(screen.queryByRole('textbox', { name: 'Description' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent(CARD_URL);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(BOARD_URL));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('navigates back to the board on a backdrop click', async () => {
    const user = userEvent.setup();
    renderAt(CARD_URL);
    const dialog = await openModal();

    const overlay = dialog.parentElement;
    expect(overlay).not.toBeNull();
    if (overlay !== null) await user.click(overlay);

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(BOARD_URL));
  });

  it('restores focus to the tile it was opened from', async () => {
    const user = userEvent.setup();
    renderAt(BOARD_URL);
    const tile = screen.getByRole('link', { name: 'Write launch announcement' });

    await user.click(tile);
    await openModal();
    await user.click(screen.getByRole('button', { name: 'Close card' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('path')).toHaveTextContent(BOARD_URL);
    await waitFor(() => expect(tile).toHaveFocus());
  });

  it('leaves no card entry behind, so Back after a close reopens nothing', async () => {
    const user = userEvent.setup();
    renderAt(BOARD_URL);

    await user.click(screen.getByRole('link', { name: 'Write launch announcement' }));
    await openModal();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Section 7.2's demo script: the Back button after a close must not return to the card.
    await user.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(screen.getByTestId('path')).toHaveTextContent(BOARD_URL);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the 404 copy for a card id that is not a card', async () => {
    renderAt('/b/7/c/0');
    expect(await screen.findByText('Card not found')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('mounts the items section and the activity feed of Section 2.6.3', async () => {
    renderAt(CARD_URL);
    const dialog = await openModal();

    // `ItemsSection` renders whether or not the card has items (Section 2.6.3).
    expect(within(dialog).getByRole('heading', { name: 'Items' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
  });

  it('shows the archived band the card asks for', async () => {
    server.use(
      http.get('/api/cards/:cardId', () =>
        HttpResponse.json(makeCardDetail({ is_archived: true })),
      ),
    );
    renderAt(CARD_URL);
    const dialog = await openModal();

    expect(within(dialog).getByText('This card is archived.')).toBeInTheDocument();
    // An archived card is the one state that offers a way back to the board (Section 2.6.4).
    expect(within(dialog).getByRole('button', { name: 'Send to board' })).toBeInTheDocument();
  });
});
