import { useState, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CardSummary, ListWithCount } from '@/api/types';
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
import { CopyCardPopover } from './CopyCardPopover';

const BOARD_ID = 7;
const CARD_ID = 101;
/** "Personal" in `boardGroupsFixture.all`: another board, whose lists come from the endpoint. */
const OTHER_BOARD = 3;
const INBOX = 21;

const OTHER_LISTS: ListWithCount[] = [
  { ...makeListOut({ id: INBOX, board_id: OTHER_BOARD, name: 'Inbox' }), card_count: 0 },
];

/** The bodies `POST /api/cards/{id}/copy` was called with, in order. */
function recordCopies(): unknown[] {
  const bodies: unknown[] = [];
  server.use(
    http.get('/api/boards/:boardId/lists', ({ params }) =>
      HttpResponse.json({
        items: params['boardId'] === String(OTHER_BOARD) ? OTHER_LISTS : listsWithCountFixture,
      }),
    ),
    http.post('/api/cards/:cardId/copy', async ({ request }) => {
      bodies.push(await request.json());
      const item: CardSummary = makeCardSummary({ id: 920, title: 'Copy' });
      return HttpResponse.json({ item, board_version: 2 }, { status: 201 });
    }),
  );
  return bodies;
}

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

function Host(): ReactElement {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button type="button" ref={setAnchor}>
        Copy
      </button>
      {anchor === null ? null : (
        <CopyCardPopover
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

describe('CopyCardPopover', () => {
  it('prefills the title and ticks every keep the card has data for', async () => {
    open();

    // `GET /api/cards/101` answers with the fixture card: one checklist, two labels, one member,
    // no attachments and no comments — so exactly three rows, all ticked (Section 2.6.5).
    expect(await screen.findByLabelText('Title')).toHaveValue('Write launch announcement');
    for (const label of ['Checklists (1)', 'Labels (2)', 'Members (1)']) {
      expect(screen.getByRole('checkbox', { name: label })).toBeChecked();
    }
    expect(screen.queryByRole('checkbox', { name: /Attachments/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Comments/ })).not.toBeInTheDocument();
  });

  it('disables the label and member keeps for another board and restores them on the way back', async () => {
    const user = userEvent.setup();
    open();

    const board = await screen.findByLabelText('Board');
    // The Board select lists `['boards']` `all[]`, which arrives with the query.
    await screen.findByRole('option', { name: 'Personal' });
    await user.selectOptions(board, String(OTHER_BOARD));

    const labels = screen.getByRole('checkbox', { name: 'Labels (2)' });
    const members = screen.getByRole('checkbox', { name: 'Members (1)' });
    await waitFor(() => expect(labels).toBeDisabled());
    expect(labels).not.toBeChecked();
    expect(members).toBeDisabled();
    expect(members).not.toBeChecked();
    // Only those two: the server copies checklists across boards (Section 4.5).
    expect(screen.getByRole('checkbox', { name: 'Checklists (1)' })).toBeEnabled();

    await user.selectOptions(board, String(BOARD_ID));

    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Labels (2)' })).toBeEnabled());
    expect(screen.getByRole('checkbox', { name: 'Labels (2)' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Members (1)' })).toBeChecked();
  });

  it('sends every flag explicitly, with the two the target board cannot keep as false', async () => {
    const user = userEvent.setup();
    const bodies = recordCopies();
    open();

    const board = await screen.findByLabelText('Board');
    // The Board select lists `['boards']` `all[]`, which arrives with the query.
    await screen.findByRole('option', { name: 'Personal' });
    await user.selectOptions(board, String(OTHER_BOARD));
    await waitFor(() => expect(screen.getByLabelText('List')).toHaveValue(String(INBOX)));
    await user.click(screen.getByRole('button', { name: 'Create card' }));

    await waitFor(() =>
      expect(bodies).toEqual([
        {
          title: 'Write launch announcement',
          to_list_id: INBOX,
          index: 0,
          keep: {
            checklists: true,
            labels: false,
            members: false,
            attachments: false,
            comments: false,
          },
        },
      ]),
    );
  });
});
