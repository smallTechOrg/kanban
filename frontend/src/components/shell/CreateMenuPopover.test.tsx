import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { CreateCardInput } from '@/api/cards';
import { listsWithCountFixture } from '@/test/handlers';
import { server } from '@/test/server';
import { CreateMenuPopover } from './CreateMenuPopover';

/** `boardGroupsFixture.all` is alphabetical, so "Personal" (3) is the Board select's default. */
const DEFAULT_BOARD = 'Personal';
const OTHER_BOARD = 'Roadmap';

function Where(): ReactElement {
  return <p>{`at ${useLocation().pathname}`}</p>;
}

function renderCreateMenu(): { onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <CreateMenuPopover anchor={document.createElement('button')} onClose={onClose} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onClose };
}

/** Opens the pushed "Create card" view and waits for the Board select to have its rows. */
async function openCreateCard(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /Create card/ }));
  await screen.findByRole('option', { name: DEFAULT_BOARD });
}

describe('CreateMenuPopover', () => {
  it('lists the boards and the chosen board’s lists, and re-reads them on a switch', async () => {
    const user = userEvent.setup();
    const asked: string[] = [];
    server.use(
      http.get('/api/boards/:boardId/lists', ({ params }) => {
        asked.push(String(params['boardId']));
        return HttpResponse.json({ items: listsWithCountFixture });
      }),
    );
    renderCreateMenu();
    await openCreateCard(user);

    // The default board's lists arrive without a click: the select opens on `all[0]`.
    expect(await screen.findByRole('option', { name: 'To Do' })).toBeInTheDocument();
    await vi.waitFor(() => expect(asked).toEqual(['3']));

    await user.selectOptions(screen.getByLabelText('Space'), OTHER_BOARD);

    await vi.waitFor(() => expect(asked).toEqual(['3', '5']));
    expect(screen.getByLabelText('List')).toHaveValue('11');
  });

  it('creates the card in the chosen list and opens it', async () => {
    const user = userEvent.setup();
    let posted: { listId: string; input: CreateCardInput } | undefined;
    server.use(
      http.post('/api/lists/:listId/cards', async ({ params, request }) => {
        posted = {
          listId: String(params['listId']),
          input: (await request.json()) as CreateCardInput,
        };
        return HttpResponse.json({
          items: [{ id: 901, list_id: Number(params['listId']) }],
          board_version: 2,
        });
      }),
    );
    const { onClose } = renderCreateMenu();
    await openCreateCard(user);
    await screen.findByRole('option', { name: 'Doing' });

    await user.type(screen.getByLabelText('Title'), 'Book the venue');
    await user.selectOptions(screen.getByLabelText('List'), 'Doing');
    await user.click(screen.getByRole('button', { name: 'Add card' }));

    await vi.waitFor(() => expect(posted?.listId).toBe('12'));
    expect(posted?.input.title).toBe('Book the venue');
    expect(await screen.findByText('at /b/3/c/901')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps "Add card" disabled until a title is typed', async () => {
    const user = userEvent.setup();
    renderCreateMenu();
    await openCreateCard(user);

    expect(screen.getByRole('button', { name: 'Add card' })).toBeDisabled();

    await user.type(screen.getByLabelText('Title'), '  ');
    expect(screen.getByRole('button', { name: 'Add card' })).toBeDisabled();

    await user.type(screen.getByLabelText('Title'), 'Ship it');
    expect(screen.getByRole('button', { name: 'Add card' })).toBeEnabled();
  });
});
