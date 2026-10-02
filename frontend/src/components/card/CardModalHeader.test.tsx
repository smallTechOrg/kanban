import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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

function open(): void {
  render(
    <QueryClientProvider client={seed()}>
      <MemoryRouter>
        <CardModalHeader
          boardId={BOARD_ID}
          cardId={CARD_ID}
          title="Design home page"
          listName="To Do"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CardModalHeader', () => {
  it('shows the list name as text, not a control (Section 2.6.2)', () => {
    open();

    expect(screen.getByText('To Do')).toBeInTheDocument();
    // A card is moved by dragging it; there is no Move panel for the sub-line to open.
    expect(screen.queryByRole('button', { name: 'To Do' })).not.toBeInTheDocument();
  });

  it('renames the card from the title, whose accessible name carries it (WCAG 2.5.3)', () => {
    open();

    expect(screen.getByRole('button', { name: 'Rename card Design home page' })).toHaveTextContent(
      'Design home page',
    );
  });
});
