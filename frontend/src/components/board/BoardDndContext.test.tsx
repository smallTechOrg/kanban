import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { boardKey } from '@/hooks/useBoardData';
import { normalizeBoard } from '@/lib/normalize';
import {
  boardPayloadFixture,
  makeBoardSummary,
  makeCardSummary,
  metaFixture,
} from '@/test/handlers';
import { BoardDndContext, CardsDroppable, ListDraggable, ListsDroppable } from './BoardDndContext';
import { CardTile } from './CardTile';

const BOARD_ID = 7;
const LIST_ID = 11;
const CARD_ID = 101;

/** The library's own attribute names: what `onDragEnd` later parses back into ids. */
const DROPPABLE_ID = 'data-rfd-droppable-id';
const DRAGGABLE_ID = 'data-rfd-draggable-id';
const DRAG_HANDLE_ID = 'data-rfd-drag-handle-draggable-id';

function renderBoard(children: ReactNode): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(['meta'], metaFixture);
  client.setQueryData(
    boardKey(BOARD_ID),
    normalizeBoard({
      ...boardPayloadFixture,
      board: makeBoardSummary({ id: BOARD_ID }),
      cards: [makeCardSummary({ id: CARD_ID })],
    }),
  );
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/b/${BOARD_ID}`]}>
        <BoardDndContext boardId={BOARD_ID}>{children}</BoardDndContext>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A stand-in for `ListColumn`, which spreads the handle props onto its header. */
function Column(): ReactElement {
  return (
    <ListsDroppable>
      <ListDraggable listId={LIST_ID} index={0}>
        {({ handleProps }) => (
          <div>
            <h2 {...handleProps} data-testid="header">
              To Do
            </h2>
            <CardsDroppable listId={LIST_ID}>
              <CardTile boardId={BOARD_ID} cardId={CARD_ID} index={0} />
            </CardsDroppable>
          </div>
        )}
      </ListDraggable>
    </ListsDroppable>
  );
}

describe('BoardDndContext', () => {
  it('registers the ids the move contract is parsed from', () => {
    renderBoard(<Column />);

    // One horizontal droppable for the columns, one "list-{id}" droppable per list body, and
    // the list's own draggable carrying the same "list-{id}" string (Section 5.5).
    expect(document.querySelector(`[${DROPPABLE_ID}="board"]`)).not.toBeNull();
    expect(document.querySelector(`[${DROPPABLE_ID}="list-${LIST_ID}"]`)).not.toBeNull();
    expect(document.querySelector(`[${DRAGGABLE_ID}="list-${LIST_ID}"]`)).not.toBeNull();
    expect(document.querySelector(`[${DRAGGABLE_ID}="card-${CARD_ID}"]`)).not.toBeNull();

    // The header is the list's only handle, and the tile's link is the card's.
    expect(screen.getByTestId('header')).toHaveAttribute(DRAG_HANDLE_ID, `list-${LIST_ID}`);
    expect(screen.getByRole('link', { name: /Write launch announcement/ })).toHaveAttribute(
      DRAG_HANDLE_ID,
      `card-${CARD_ID}`,
    );
  });
});
