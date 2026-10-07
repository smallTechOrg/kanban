import { useState, type ReactElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardSummary, Meta } from '@/api/types';
import type * as BoardData from '@/hooks/useBoardData';
import { boardKey } from '@/hooks/useBoardData';
import { applyCardPatch, type BoardState } from '@/lib/boardState';
import { normalizeBoard } from '@/lib/normalize';
import { useUiStore } from '@/store/uiStore';
import {
  boardPayloadFixture,
  makeBoardSummary,
  makeCardSummary,
  metaFixture,
} from '@/test/handlers';
import { BoardDndContext, CardsDroppable } from './BoardDndContext';
import { CardTile } from './CardTile';

/**
 * Renders are counted through `useCard`, the public hook every tile reads its row with: one
 * call is one render of one tile, which is exactly what Section 5.11 promises. Counting from
 * inside the component (a `Profiler`, a wrapper) cannot work — the point of `React.memo` is
 * that nothing inside the tile runs at all.
 */
const { renders } = vi.hoisted(() => ({ renders: [] as number[] }));

vi.mock('@/hooks/useBoardData', async (importOriginal) => {
  const actual = await importOriginal<typeof BoardData>();
  return {
    ...actual,
    useCard: function useCard(boardId: number, cardId: number) {
      renders.push(cardId);
      return actual.useCard(boardId, cardId);
    },
  };
});

const BOARD_ID = 7;
const LIST_ID = 11;
const FIRST = 101;
const SECOND = 102;

/** The fixture board with the cards a test needs, normalised the way the cache holds it. */
function seed(cards: CardSummary[], meta: Meta = metaFixture): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  // `['meta']` is `useMeta`'s key: seeding the palette keeps these tests free of the network,
  // so no late query response can be mistaken for a re-render.
  client.setQueryData(['meta'], meta);
  client.setQueryData(
    boardKey(BOARD_ID),
    normalizeBoard({
      ...boardPayloadFixture,
      board: makeBoardSummary({ id: BOARD_ID }),
      cards,
    }),
  );
  return client;
}

function renderBoard(ui: ReactNode, client: QueryClient): void {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/b/${BOARD_ID}`]}>
        <BoardDndContext boardId={BOARD_ID}>
          <CardsDroppable listId={LIST_ID}>{ui}</CardsDroppable>
        </BoardDndContext>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A parent that re-renders on demand while every tile's props stay identical. */
function Harness({ cardIds }: { cardIds: readonly number[] }): ReactElement {
  const [bump, setBump] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setBump(bump + 1)}>
        {`Bump ${String(bump)}`}
      </button>
      {cardIds.map((cardId, at) => (
        <CardTile key={cardId} boardId={BOARD_ID} cardId={cardId} index={at} />
      ))}
    </>
  );
}

function countFor(cardId: number): number {
  return renders.filter((id) => id === cardId).length;
}

afterEach(() => {
  renders.length = 0;
  // The store is a module singleton, so it is reset for the next test. This runs before
  // Testing Library's own cleanup (hooks unwind last-registered first), so the tiles are still
  // mounted and the reset is a React update like any other.
  act(() => {
    useUiStore.getState().setQuickEditCardId(null);
    useUiStore.getState().setLabelTextMode(false);
  });
});

describe('CardTile', () => {
  it('renders the title as a card link with its label chips and badges', async () => {
    const card = makeCardSummary({
      id: FIRST,
      label_ids: [31, 32],
      due_at: '2020-01-15T12:00:00.000Z',
      badges: {
        description: true,
        item_done: 1,
        item_total: 3,
      },
    });
    renderBoard(<CardTile boardId={BOARD_ID} cardId={FIRST} index={0} />, seed([card]));

    expect(screen.getByRole('link', { name: /Write launch announcement/ })).toHaveAttribute(
      'href',
      `/b/${BOARD_ID}/c/${FIRST}`,
    );
    expect(screen.getByLabelText('Label green')).toBeInTheDocument();
    expect(screen.getByLabelText('Label Bug fix')).toBeInTheDocument();
    expect(screen.getByTitle('Overdue')).toHaveTextContent('Jan 15, 2020');
    expect(screen.getByLabelText('This card has a description.')).toBeInTheDocument();
    expect(screen.getByTitle('Items')).toHaveTextContent('1/3');

    // Section 2.5.2: clicking a chip switches every tile to the label-text mode.
    await userEvent.click(screen.getByLabelText('Label Bug fix'));
    expect(screen.getByLabelText('Label Bug fix')).toHaveTextContent('Bug fix');
  });

  it('lists the card items under the title, ticked ones included, as text', () => {
    const card = makeCardSummary({
      id: FIRST,
      badges: { description: false, item_done: 1, item_total: 2 },
      items: [
        {
          id: 51,
          card_id: FIRST,
          name: 'Book the venue',
          position: 65536,
          is_checked: true,
          checked_at: '2026-09-24T09:00:00.000Z',
          due_at: null,
        },
        {
          id: 52,
          card_id: FIRST,
          name: 'Send the invite',
          position: 131072,
          is_checked: false,
          checked_at: null,
          due_at: null,
        },
      ],
    });
    renderBoard(<CardTile boardId={BOARD_ID} cardId={FIRST} index={0} />, seed([card]));

    // Section 2.5.1: both rows are on the tile, in the card's own order, and a done one says so
    // in its accessible name because neither the tick nor the line through it is announced.
    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'Book the venue',
      'Send the invite',
    ]);
    expect(screen.getByLabelText('Book the venue (done)')).toBeInTheDocument();
    expect(screen.getByLabelText('Send the invite')).toBeInTheDocument();

    // They are not controls: the card has exactly one tab stop and ticking happens in the modal.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByTitle('Items')).toHaveTextContent('1/2');
  });

  it('omits every block the card has no data for', () => {
    renderBoard(
      <CardTile boardId={BOARD_ID} cardId={FIRST} index={0} />,
      seed([makeCardSummary({ id: FIRST, title: 'Bare card' })]),
    );

    expect(screen.getByText('Bare card')).toBeInTheDocument();
    expect(screen.queryByTitle('Items')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Label /)).not.toBeInTheDocument();
    // A card with no items renders no list at all, not an empty one.
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('re-renders one tile when one card changes, and none when a parent repaints', async () => {
    const user = userEvent.setup();
    const client = seed([
      makeCardSummary({ id: FIRST, title: 'First card' }),
      makeCardSummary({ id: SECOND, title: 'Second card', position: 131072 }),
    ]);
    renderBoard(<Harness cardIds={[FIRST, SECOND]} />, client);

    const before = { first: countFor(FIRST), second: countFor(SECOND) };
    expect(before.first).toBeGreaterThan(0);

    // A parent re-render with unchanged props must not reach either tile (React.memo).
    await user.click(screen.getByRole('button', { name: 'Bump 0' }));
    expect(screen.getByRole('button', { name: 'Bump 1' })).toBeInTheDocument();
    expect(countFor(FIRST)).toBe(before.first);
    expect(countFor(SECOND)).toBe(before.second);

    // One card changing repaints that card's tile only (the selector returns the same row
    // object for every other card, so their subscriptions do not fire).
    // The cache notifies its observers on a macrotask, so the flush belongs inside `act`.
    await act(async () => {
      client.setQueryData<BoardState>(boardKey(BOARD_ID), (previous) =>
        previous === undefined
          ? undefined
          : applyCardPatch(previous, SECOND, { title: 'Second card, renamed' }),
      );
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    expect(screen.getByText('Second card, renamed')).toBeInTheDocument();
    expect(countFor(SECOND)).toBeGreaterThan(before.second);
    expect(countFor(FIRST)).toBe(before.first);
  });

  it('opens the quick editor from the hover pencil', async () => {
    const user = userEvent.setup();
    renderBoard(
      <CardTile boardId={BOARD_ID} cardId={FIRST} index={0} />,
      seed([makeCardSummary({ id: FIRST })]),
    );

    await user.click(screen.getByRole('button', { name: 'Edit card' }));

    expect(await screen.findByRole('button', { name: 'Open card' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });
});
