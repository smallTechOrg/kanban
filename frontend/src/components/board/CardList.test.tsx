import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { CardSummary } from '@/api/types';
import type * as BoardData from '@/hooks/useBoardData';
import { boardKey } from '@/hooks/useBoardData';
import { applyCardPatch, type BoardState } from '@/lib/boardState';
import { normalizeBoard } from '@/lib/normalize';
import {
  boardPayloadFixture,
  makeBoardSummary,
  makeCardSummary,
  makeListOut,
  metaFixture,
} from '@/test/handlers';
import { BoardDndContext, ListsDroppable } from './BoardDndContext';
import { ListColumn } from './ListColumn';

/**
 * The Section 5.11 budget, measured on the real column: `ListColumn` -> `CardList` ->
 * `CardTile`, not on tiles rendered by hand.
 *
 * Every render is counted through the hook the component reads its own slice with, because
 * that is the only place a render can be observed from outside: `React.memo` means nothing
 * inside the component runs when it bails out, so a `Profiler` or a wrapper would count the
 * parent's work instead. One `useCard` call is one `CardTile` render, one `useList` call is one
 * `ListColumn` render, and one `useListCards` call is one `CardList` render.
 */
const { cardRenders, columnRenders, listRenders } = vi.hoisted(() => ({
  cardRenders: [] as number[],
  columnRenders: [] as number[],
  listRenders: [] as number[],
}));

vi.mock('@/hooks/useBoardData', async (importOriginal) => {
  const actual = await importOriginal<typeof BoardData>();
  return {
    ...actual,
    useCard: function useCard(boardId: number, cardId: number) {
      cardRenders.push(cardId);
      return actual.useCard(boardId, cardId);
    },
    useList: function useList(boardId: number, listId: number) {
      columnRenders.push(listId);
      return actual.useList(boardId, listId);
    },
    useListCards: function useListCards(boardId: number, listId: number) {
      listRenders.push(listId);
      return actual.useListCards(boardId, listId);
    },
  };
});

const BOARD_ID = 7;
const LIST_ID = 11;
/** One column of the `--big` fixture (Section 3.10): 30 lists of this many cards. */
const CARD_COUNT = 100;
const FIRST = 1001;

function bigListCards(): CardSummary[] {
  return Array.from({ length: CARD_COUNT }, (_row, index) =>
    makeCardSummary({
      id: FIRST + index,
      short_id: index + 1,
      list_id: LIST_ID,
      title: `Card ${String(index + 1)}`,
      position: 65536 * (index + 1),
    }),
  );
}

function seed(cards: CardSummary[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  client.setQueryData(['meta'], metaFixture);
  client.setQueryData(
    boardKey(BOARD_ID),
    normalizeBoard({
      ...boardPayloadFixture,
      board: makeBoardSummary({ id: BOARD_ID }),
      lists: [makeListOut({ id: LIST_ID, name: 'To Do' })],
      cards,
    }),
  );
  return client;
}

function renderColumn(client: QueryClient): void {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/b/${String(BOARD_ID)}`]}>
        <BoardDndContext boardId={BOARD_ID}>
          <ListsDroppable>
            <ListColumn boardId={BOARD_ID} listId={LIST_ID} index={0} />
          </ListsDroppable>
        </BoardDndContext>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Writes one card's new title into the cache exactly as a server merge would. */
async function renameCard(client: QueryClient, cardId: number, title: string): Promise<void> {
  // The cache notifies its observers on a macrotask, so the flush belongs inside `act`.
  await act(async () => {
    client.setQueryData<BoardState>(boardKey(BOARD_ID), (previous) =>
      previous === undefined ? undefined : applyCardPatch(previous, cardId, { title }),
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

function reset(): void {
  cardRenders.length = 0;
  columnRenders.length = 0;
  listRenders.length = 0;
}

describe('CardList', () => {
  it('renders every active card of its list as a tile', () => {
    renderColumn(seed(bigListCards()));

    expect(screen.getByRole('link', { name: 'Card 1' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `Card ${String(CARD_COUNT)}` })).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(CARD_COUNT);
  });

  it('re-renders one tile, not the column, when one card of a hundred changes', async () => {
    const client = seed(bigListCards());
    renderColumn(client);
    const mounted = cardRenders.length;
    expect(mounted).toBeGreaterThanOrEqual(CARD_COUNT);
    reset();

    await renameCard(client, FIRST + 42, 'Card 43, renamed');

    expect(screen.getByRole('link', { name: 'Card 43, renamed' })).toBeInTheDocument();
    // Section 5.11: one card change re-renders one tile. The other 99 are `React.memo` with
    // unchanged props, and their `useCard` selectors return the same row object.
    expect(new Set(cardRenders)).toEqual(new Set([FIRST + 42]));
    // The column itself reads a card *count*, not the rows, so an edit that does not add or
    // remove a card leaves its selector's answer identical and never reaches `ListHeader`.
    expect(columnRenders).toEqual([]);
  });

  it('repaints the column once when a card leaves the list', async () => {
    const client = seed(bigListCards());
    renderColumn(client);
    reset();

    await renameCard(client, FIRST, 'Archived card');
    await act(async () => {
      client.setQueryData<BoardState>(boardKey(BOARD_ID), (previous) =>
        previous === undefined ? undefined : applyCardPatch(previous, FIRST, { is_archived: true }),
      );
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    expect(screen.queryByRole('link', { name: 'Archived card' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(CARD_COUNT - 1);
    // The count changed, so the header's "99" has to be repainted - once.
    expect(columnRenders).toEqual([LIST_ID]);
    expect(listRenders.filter((id) => id === LIST_ID).length).toBeGreaterThan(0);
  });
});
