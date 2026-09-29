import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CardSummary } from '@/api/types';
import { boardKey } from '@/hooks/useBoardData';
import { normalizeBoard } from '@/lib/normalize';
import { EMPTY_FILTER, useUiStore } from '@/store/uiStore';
import {
  boardPayloadFixture,
  labelFixtures,
  makeBoardSummary,
  makeCardSummary,
  metaFixture,
} from '@/test/handlers';
import { BoardCanvas } from './BoardCanvas';
import { BoardHeader } from './BoardHeader';
import cardStyles from './CardTile.module.css';

const BOARD_ID = 7;
/** `labelFixtures[1]`, the only named label of the fixture board. */
const BUG_FIX = 32;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One class of the tile stylesheet, resolved once so a rename fails loudly. */
function cardClass(name: string): string {
  const value = cardStyles[name];
  if (value === undefined) throw new Error(`CardTile.module.css has no .${name}`);
  return value;
}

const TILE = cardClass('tile');
const HIDDEN = cardClass('hidden');

/** Two cards that differ in title, label, due date, status and last activity. */
function cards(): CardSummary[] {
  return [
    makeCardSummary({
      id: 101,
      title: 'Launch plan',
      label_ids: [BUG_FIX],
      due_at: new Date(Date.now() - DAY_MS).toISOString(),
      due_complete: false,
      updated_at: new Date(Date.now() - DAY_MS).toISOString(),
    }),
    makeCardSummary({
      id: 102,
      title: 'Launch notes',
      position: 2 * 65536,
      label_ids: [],
      due_at: null,
      due_complete: true,
      updated_at: new Date(Date.now() - 40 * DAY_MS).toISOString(),
    }),
  ];
}

/** Shows the query string the filter is mirrored to (Section 2.3.3). */
function UrlProbe(): ReactElement {
  const [params] = useSearchParams();
  return <output data-testid="query">{params.toString()}</output>;
}

/**
 * The header, one list of tiles and the URL probe: everything the filter touches, with the
 * board and the palette seeded so no assertion waits on the network.
 */
function renderBoard(route = `/b/${BOARD_ID}`, rows: CardSummary[] = cards()): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  client.setQueryData(['meta'], metaFixture);
  client.setQueryData(
    boardKey(BOARD_ID),
    normalizeBoard({
      ...boardPayloadFixture,
      board: makeBoardSummary({ id: BOARD_ID }),
      labels: labelFixtures,
      cards: rows,
    }),
  );

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <BoardHeader boardId={BOARD_ID} />
        <BoardCanvas boardId={BOARD_ID} />
        <UrlProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Whether the tile of `title` is painted. The tiles are read out of the DOM rather than through
 * `getByRole`, because an open `Popover` is a focus-modal: everything behind it is `aria-hidden`,
 * so the board's links are not in the accessibility tree while the filter panel is up.
 */
function isVisible(title: string): boolean {
  const tile = screen.getByText(title).closest<HTMLElement>(`.${TILE}`);
  if (tile === null) throw new Error(`no tile for ${title}`);
  return !tile.classList.contains(HIDDEN);
}

/** The header's Filter control, whether it is the plain button or the "N filters" pill. */
function filterControl(): HTMLElement {
  return screen.getByRole('button', { name: /^(Filter|\d+ filters?)$/ });
}

async function openFilter(): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(filterControl());
  return screen.getByRole('dialog');
}

beforeEach(() => {
  useUiStore.setState({ filter: EMPTY_FILTER, openPopover: null, boardMenuOpen: false });
});

afterEach(() => {
  useUiStore.setState({ filter: EMPTY_FILTER, openPopover: null, boardMenuOpen: false });
});

describe('FilterPopover', () => {
  it('shows every card while nothing is selected', () => {
    renderBoard();

    expect(isVisible('Launch plan')).toBe(true);
    expect(isVisible('Launch notes')).toBe(true);
  });

  it('narrows the visible set by keyword', async () => {
    const user = userEvent.setup();
    renderBoard();
    const panel = await openFilter();

    await user.type(within(panel).getByLabelText('Keyword'), 'notes');

    expect(isVisible('Launch notes')).toBe(true);
    expect(isVisible('Launch plan')).toBe(false);
  });

  it('narrows by label, status, due date and activity', async () => {
    const user = userEvent.setup();
    renderBoard();
    const panel = await openFilter();

    await user.click(within(panel).getByRole('checkbox', { name: /Bug fix/ }));
    expect(isVisible('Launch plan')).toBe(true);
    expect(isVisible('Launch notes')).toBe(false);
    await user.click(within(panel).getByRole('checkbox', { name: /Bug fix/ }));

    await user.click(within(panel).getByRole('checkbox', { name: 'Marked as complete' }));
    expect(isVisible('Launch notes')).toBe(true);
    expect(isVisible('Launch plan')).toBe(false);
    await user.click(within(panel).getByRole('checkbox', { name: 'Marked as complete' }));

    await user.click(within(panel).getByRole('checkbox', { name: 'Overdue' }));
    expect(isVisible('Launch plan')).toBe(true);
    expect(isVisible('Launch notes')).toBe(false);
    await user.click(within(panel).getByRole('checkbox', { name: 'Overdue' }));

    await user.click(
      within(panel).getByRole('radio', { name: 'Without activity in the last four weeks' }),
    );
    expect(isVisible('Launch notes')).toBe(true);
    expect(isVisible('Launch plan')).toBe(false);
  });

  it('clears the Activity group when its selected radio is clicked again', async () => {
    const user = userEvent.setup();
    renderBoard();
    const panel = await openFilter();
    const radio = within(panel).getByRole('radio', { name: 'Active in the last week' });

    await user.click(radio);
    expect(isVisible('Launch notes')).toBe(false);

    await user.click(radio);
    expect(radio).not.toBeChecked();
    expect(isVisible('Launch notes')).toBe(true);
  });

  it('combines two groups with Any match, and requires both with Exact match', async () => {
    const user = userEvent.setup();
    renderBoard();
    const panel = await openFilter();

    await user.type(within(panel).getByLabelText('Keyword'), 'launch');
    await user.click(within(panel).getByRole('checkbox', { name: /Bug fix/ }));

    // "Launch notes" carries no label, so it survives on the keyword alone.
    expect(isVisible('Launch plan')).toBe(true);
    expect(isVisible('Launch notes')).toBe(true);

    await user.selectOptions(within(panel).getByLabelText('Match'), 'all');

    expect(isVisible('Launch plan')).toBe(true);
    expect(isVisible('Launch notes')).toBe(false);
  });

  it('mirrors the filter into the URL query string', async () => {
    const user = userEvent.setup();
    renderBoard();
    const panel = await openFilter();

    await user.type(within(panel).getByLabelText('Keyword'), 'launch');
    await user.click(within(panel).getByRole('checkbox', { name: /Bug fix/ }));
    await user.click(within(panel).getByRole('checkbox', { name: 'Overdue' }));
    await user.selectOptions(within(panel).getByLabelText('Match'), 'all');

    expect(screen.getByTestId('query')).toHaveTextContent(
      'q=launch&labels=32&due=overdue&match=all',
    );
  });

  it('reads the filter back out of the URL and shows it in the header pill', async () => {
    renderBoard(`/b/${BOARD_ID}?q=notes&due=none`);

    expect(await screen.findByRole('button', { name: '2 filters' })).toBeInTheDocument();
    expect(isVisible('Launch notes')).toBe(true);
    expect(isVisible('Launch plan')).toBe(false);

    const panel = await openFilter();
    expect(within(panel).getByLabelText('Keyword')).toHaveValue('notes');
    expect(within(panel).getByRole('checkbox', { name: 'No dates' })).toBeChecked();
  });

  it('clears everything from the pill, and empties the query string with it', async () => {
    const user = userEvent.setup();
    renderBoard(`/b/${BOARD_ID}?q=notes`);

    expect(await screen.findByRole('button', { name: '1 filter' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear all filters' }));

    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
    expect(screen.getByTestId('query')).toHaveTextContent('');
    expect(isVisible('Launch plan')).toBe(true);
  });

  it('counts the matched cards in the list header while a filter is active', async () => {
    renderBoard(`/b/${BOARD_ID}?q=notes`);

    expect(await screen.findByRole('button', { name: '1 filter' })).toBeInTheDocument();
    // Section 2.4.2: one of the two cards of "To Do" survives the keyword.
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });
});
