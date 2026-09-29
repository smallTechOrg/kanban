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

/**
 * `metaFixture` publishes no cover colours, and a tile resolves a colour cover through that
 * palette, so the one key these tests use is supplied as the server would — as a token, because
 * the fixture stands in for the server's answer rather than for a second palette.
 */
const COVER_META: Meta = { ...metaFixture, cover_colors: { green: 'var(--success)' } };

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
    useUiStore.getState().setCardCoversEnabled(true);
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
        attachments: 1,
        checklist_done: 1,
        checklist_total: 3,
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
    expect(screen.getByTitle('Attachments')).toHaveTextContent('1');
    expect(screen.getByTitle('Checklist items')).toHaveTextContent('1/3');

    // Section 2.5.2: clicking a chip switches every tile to the label-text mode.
    await userEvent.click(screen.getByLabelText('Label Bug fix'));
    expect(screen.getByLabelText('Label Bug fix')).toHaveTextContent('Bug fix');
  });

  it('omits every block the card has no data for', () => {
    renderBoard(
      <CardTile boardId={BOARD_ID} cardId={FIRST} index={0} />,
      seed([makeCardSummary({ id: FIRST, title: 'Bare card' })]),
    );

    expect(screen.getByText('Bare card')).toBeInTheDocument();
    expect(screen.queryByTitle('Attachments')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Checklist items')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Label /)).not.toBeInTheDocument();
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

  it('paints a full cover over the whole tile, with the title on it and no badges', () => {
    renderBoard(
      <CardTile boardId={BOARD_ID} cardId={FIRST} index={0} />,
      seed(
        [
          makeCardSummary({
            id: FIRST,
            title: 'Covered card',
            due_at: '2020-01-15T12:00:00.000Z',
            cover: { kind: 'color', value: 'green', size: 'full' },
          }),
        ],
        COVER_META,
      ),
    );

    // The title is still the card's link, so the cover never costs the tile its click target.
    expect(screen.getByRole('link', { name: /Covered card/ })).toBeInTheDocument();
    // Section 2.5.1: a full cover hides the badges, which are left out rather than painted over.
    expect(screen.queryByTitle('Overdue')).not.toBeInTheDocument();
  });

  it('keeps the badges beside a normal cover, and drops the cover when covers are off', () => {
    const card = makeCardSummary({
      id: FIRST,
      title: 'Covered card',
      due_at: '2020-01-15T12:00:00.000Z',
      cover: { kind: 'color', value: 'green', size: 'normal' },
    });
    renderBoard(<CardTile boardId={BOARD_ID} cardId={FIRST} index={0} />, seed([card], COVER_META));

    expect(screen.getByTitle('Overdue')).toBeInTheDocument();

    // Section 2.3.4's "Card covers enabled" switch hides the band, badges and all intact.
    act(() => {
      useUiStore.getState().setCardCoversEnabled(false);
    });
    expect(screen.getByTitle('Overdue')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Covered card/ })).toBeInTheDocument();
  });
});
