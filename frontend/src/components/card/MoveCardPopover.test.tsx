import { useState, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CardSummary, ListWithCount, MoveResult } from '@/api/types';
import { boardKey } from '@/hooks/useBoardData';
import { normalizeBoard } from '@/lib/normalize';
import {
  boardGroupsFixture,
  boardPayloadFixture,
  cardFixtures,
  listsWithCountFixture,
  makeBoardSummary,
  makeCardSummary,
  makeListOut,
  metaFixture,
} from '@/test/handlers';
import { server } from '@/test/server';
import { MoveCardPopover } from './MoveCardPopover';

const BOARD_ID = 7;
const CARD_ID = 101;
/** "Personal" in `boardGroupsFixture.all`, a board whose payload the client does not hold. */
const OTHER_BOARD = 3;
const INBOX = 21;

/** The other board's single column, which only `GET /api/boards/3/lists` can supply. */
const OTHER_LISTS: ListWithCount[] = [
  { ...makeListOut({ id: INBOX, board_id: OTHER_BOARD, name: 'Inbox' }), card_count: 2 },
];

/** The bodies `POST /api/cards/{id}/move` was called with, in order. */
function recordMoves(): unknown[] {
  const bodies: unknown[] = [];
  server.use(
    http.get('/api/boards/:boardId/lists', ({ params }) =>
      HttpResponse.json({
        items: params['boardId'] === String(OTHER_BOARD) ? OTHER_LISTS : listsWithCountFixture,
      }),
    ),
    http.post('/api/cards/:cardId/move', async ({ request }) => {
      bodies.push(await request.json());
      const item: CardSummary = makeCardSummary({ id: CARD_ID });
      const result: MoveResult<CardSummary> = { item, positions: {}, board_version: 2 };
      return HttpResponse.json(result);
    }),
  );
  return bodies;
}

/** The caches the board page leaves behind: the board document, the palette and my boards. */
function seed(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(['meta'], metaFixture);
  client.setQueryData(['boards'], boardGroupsFixture);
  client.setQueryData(
    boardKey(BOARD_ID),
    normalizeBoard({
      ...boardPayloadFixture,
      board: makeBoardSummary({ id: BOARD_ID }),
      cards: cardFixtures,
    }),
  );
  return client;
}

/** The popover hangs off the sidebar row that opened it, so the test gives it a real element. */
function Host(): ReactElement {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button type="button" ref={setAnchor}>
        Move
      </button>
      {anchor === null ? null : (
        <MoveCardPopover
          boardId={BOARD_ID}
          cardId={CARD_ID}
          anchor={anchor}
          onClose={() => undefined}
        />
      )}
    </>
  );
}

function open(): void {
  render(
    <QueryClientProvider client={seed()}>
      <Host />
    </QueryClientProvider>,
  );
}

describe('MoveCardPopover', () => {
  it('opens on the card’s own list and slot, read from the board cache', async () => {
    open();

    expect(await screen.findByLabelText('Board')).toHaveValue(String(BOARD_ID));
    expect(screen.getByLabelText('List')).toHaveValue('11');
    // Card 101 is the first of the two cards in "To Do", and it is not its own sibling: two
    // slots, the first of them marked as the one it is in.
    const position = screen.getByLabelText('Position');
    expect(position).toHaveValue('1');
    expect(
      within(position)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['1 (current)', '2']);
  });

  it('sends the index form alone for a move inside the board', async () => {
    const user = userEvent.setup();
    const bodies = recordMoves();
    open();

    await user.selectOptions(await screen.findByLabelText('List'), '12');
    await user.click(screen.getByRole('button', { name: 'Move' }));

    // "Doing" holds one card, so slot 1 is index 0 — and no neighbour ids, which belong to
    // `onDragEnd` alone (Section 4.9).
    await waitFor(() => expect(bodies).toEqual([{ to_list_id: 12, index: 0 }]));
  });

  it('reloads the list select for another board and sends to_board_id', async () => {
    const user = userEvent.setup();
    const bodies = recordMoves();
    open();

    const board = await screen.findByLabelText('Board');
    // The Board select lists `['boards']` `all[]`, which arrives with the query.
    await screen.findByRole('option', { name: 'Personal' });
    await user.selectOptions(board, String(OTHER_BOARD));

    const list = await screen.findByLabelText('List');
    await waitFor(() => expect(list).toHaveValue(String(INBOX)));
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Inbox']);

    // The other board's two cards make three slots, and none of them is "(current)".
    const position = screen.getByLabelText('Position');
    expect(
      within(position)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['1', '2', '3']);

    await user.selectOptions(position, '3');
    await user.click(screen.getByRole('button', { name: 'Move' }));

    await waitFor(() =>
      expect(bodies).toEqual([{ to_list_id: INBOX, index: 2, to_board_id: OTHER_BOARD }]),
    );
  });
});
