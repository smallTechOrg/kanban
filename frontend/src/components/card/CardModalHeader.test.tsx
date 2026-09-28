import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { boardKey } from '@/hooks/useBoardData';
import { normalizeBoard } from '@/lib/normalize';
import { boardPayloadFixture, makeBoardSummary, metaFixture } from '@/test/handlers';
import { CardModalHeader } from './CardModalHeader';

const BOARD_ID = 7;
const CARD_ID = 101;

/** The board cache the header's Move popover reads its own board and slots from. */
function seed(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(['meta'], metaFixture);
  client.setQueryData(
    boardKey(BOARD_ID),
    normalizeBoard({ ...boardPayloadFixture, board: makeBoardSummary({ id: BOARD_ID }) }),
  );
  return client;
}

function open(isWatching = false): void {
  render(
    <QueryClientProvider client={seed()}>
      <MemoryRouter>
        <CardModalHeader
          boardId={BOARD_ID}
          cardId={CARD_ID}
          title="Design home page"
          listName="To Do"
          isWatching={isWatching}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CardModalHeader', () => {
  it('opens the Move popover from the list name (Section 2.6.2)', async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole('button', { name: 'To Do' }));

    expect(await screen.findByRole('dialog', { name: 'Move card' })).toBeInTheDocument();
  });

  it('shows the eye only while the card is watched, and never as a control', () => {
    open();
    expect(screen.queryByText('Watching this card')).not.toBeInTheDocument();

    open(true);
    // Section 2.6.2 makes the eye a state indicator; the two Watch buttons are elsewhere.
    expect(screen.getByText('Watching this card')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /watch/i })).not.toBeInTheDocument();
  });
});
