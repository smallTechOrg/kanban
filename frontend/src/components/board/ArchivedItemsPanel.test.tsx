import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CardSummary, ListOut } from '@/api/types';
import { makeCardSummary, makeListOut } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { ArchivedItemsPanel } from './ArchivedItemsPanel';

const BOARD_ID = 7;

const ARCHIVED_CARDS: CardSummary[] = [
  makeCardSummary({ id: 101, title: 'Write launch announcement', is_archived: true }),
  makeCardSummary({ id: 102, title: 'Draft the brief', is_archived: true }),
];

const ARCHIVED_LISTS: ListOut[] = [makeListOut({ id: 12, name: 'Doing', is_archived: true })];

/**
 * The archive as a server would answer it: one page per half, filtered by `q`, with the rows a
 * restore or a delete has removed gone from the next answer — which is what lets a test assert
 * that the row leaves the panel rather than that a request was sent.
 */
function serveArchive(): string[] {
  const calls: string[] = [];
  const gone = new Set<number>();

  server.use(
    http.get('/api/boards/:boardId/archived', ({ request }) => {
      const params = new URL(request.url).searchParams;
      const q = (params.get('q') ?? '').toLowerCase();
      if (params.get('type') === 'lists') {
        const items = ARCHIVED_LISTS.filter(
          (list) => !gone.has(list.id) && list.name.toLowerCase().includes(q),
        );
        return HttpResponse.json({ items, next_before: null });
      }
      const items = ARCHIVED_CARDS.filter(
        (card) => !gone.has(card.id) && card.title.toLowerCase().includes(q),
      );
      return HttpResponse.json({ items, next_before: null });
    }),

    http.post('/api/cards/:cardId/unarchive', ({ params }) => {
      const cardId = Number(params['cardId']);
      calls.push(`POST /cards/${String(cardId)}/unarchive`);
      gone.add(cardId);
      return HttpResponse.json({
        item: makeCardSummary({ id: cardId, is_archived: false }),
        board_version: 2,
      });
    }),
    http.delete('/api/cards/:cardId', ({ params }) => {
      const cardId = Number(params['cardId']);
      calls.push(`DELETE /cards/${String(cardId)}`);
      gone.add(cardId);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/api/lists/:listId/unarchive', ({ params }) => {
      const listId = Number(params['listId']);
      calls.push(`POST /lists/${String(listId)}/unarchive`);
      gone.add(listId);
      return HttpResponse.json({
        item: makeListOut({ id: listId, is_archived: false }),
        board_version: 2,
      });
    }),
    http.delete('/api/lists/:listId', ({ params }) => {
      const listId = Number(params['listId']);
      calls.push(`DELETE /lists/${String(listId)}`);
      gone.add(listId);
      return new HttpResponse(null, { status: 204 });
    }),
  );

  return calls;
}

/** The row of one archived card or list: the `<li>` holding its miniature and its two links. */
function row(name: string): HTMLElement {
  const item = screen.getByText(name).closest('li');
  if (item === null) throw new Error(`no archived row for ${name}`);
  return item;
}

describe('ArchivedItemsPanel', () => {
  it('lists the archived cards with their two actions', async () => {
    serveArchive();
    renderWithProviders(<ArchivedItemsPanel boardId={BOARD_ID} />);

    expect(await screen.findByText('Write launch announcement')).toBeInTheDocument();
    expect(screen.getByText('Draft the brief')).toBeInTheDocument();
    expect(
      within(row('Draft the brief')).getByRole('button', { name: 'Put back' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to lists' })).toBeInTheDocument();
  });

  it('restores a card with "Put back" and the row leaves the panel', async () => {
    const user = userEvent.setup();
    const calls = serveArchive();
    renderWithProviders(<ArchivedItemsPanel boardId={BOARD_ID} />);

    await screen.findByText('Write launch announcement');
    await user.click(
      within(row('Write launch announcement')).getByRole('button', { name: 'Put back' }),
    );

    await waitFor(() => {
      expect(screen.queryByText('Write launch announcement')).not.toBeInTheDocument();
    });
    expect(calls).toEqual(['POST /cards/101/unarchive']);
    expect(screen.getByText('Draft the brief')).toBeInTheDocument();
  });

  it('deletes a card only after the confirm popover', async () => {
    const user = userEvent.setup();
    const calls = serveArchive();
    renderWithProviders(<ArchivedItemsPanel boardId={BOARD_ID} />);

    await screen.findByText('Draft the brief');
    await user.click(within(row('Draft the brief')).getByRole('button', { name: 'Delete' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete card?')).toBeInTheDocument();
    expect(calls).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(calls).toEqual(['DELETE /cards/102']);
    });
    await waitFor(() => {
      expect(screen.queryByText('Draft the brief')).not.toBeInTheDocument();
    });
  });

  it('switches to the archived lists and restores one of them', async () => {
    const user = userEvent.setup();
    const calls = serveArchive();
    renderWithProviders(<ArchivedItemsPanel boardId={BOARD_ID} />);

    await screen.findByText('Write launch announcement');
    await user.click(screen.getByRole('button', { name: 'Switch to lists' }));

    expect(await screen.findByText('Doing')).toBeInTheDocument();
    expect(screen.queryByText('Write launch announcement')).not.toBeInTheDocument();

    await user.click(within(row('Doing')).getByRole('button', { name: 'Put back' }));

    await waitFor(() => {
      expect(calls).toEqual(['POST /lists/12/unarchive']);
    });
    expect(await screen.findByText('No archived lists')).toBeInTheDocument();
  });

  it('searches the archive, and says so when nothing is left', async () => {
    const user = userEvent.setup();
    serveArchive();
    renderWithProviders(<ArchivedItemsPanel boardId={BOARD_ID} />);

    await screen.findByText('Write launch announcement');
    await user.type(screen.getByRole('textbox', { name: 'Search archive' }), 'brief');

    await waitFor(() => {
      expect(screen.queryByText('Write launch announcement')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Draft the brief')).toBeInTheDocument();

    await user.clear(screen.getByRole('textbox', { name: 'Search archive' }));
    await user.type(screen.getByRole('textbox', { name: 'Search archive' }), 'nothing here');

    expect(await screen.findByText('No archived cards')).toBeInTheDocument();
  });

  it('distinguishes a failed read from an empty archive', async () => {
    server.use(
      http.get('/api/boards/:boardId/archived', () => new HttpResponse(null, { status: 500 })),
    );
    renderWithProviders(<ArchivedItemsPanel boardId={BOARD_ID} />);

    expect(await screen.findByText("Couldn't load archived items.")).toBeInTheDocument();
    expect(screen.queryByText('No archived cards')).not.toBeInTheDocument();
  });
});
