import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '@/store/uiStore';
import { SearchPopover } from './SearchPopover';

/** The search handler filters the fixtures by the typed text, like the server's FTS statement. */
const BOARD_NAME = 'Website relaunch';
const CARD_TITLE = 'Write launch announcement';

function Where(): ReactElement {
  return <p>{`at ${useLocation().pathname}`}</p>;
}

function renderSearch(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <SearchPopover />
        <Where />
        <Routes>
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SearchPopover', () => {
  beforeEach(() => {
    useUiStore.getState().setOpenPopover(null);
  });

  it('shows the Boards and Cards groups for the typed text', async () => {
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole('textbox', { name: 'Search' }));
    await user.keyboard('launch');

    expect(await screen.findByRole('heading', { name: 'Boards' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cards' })).toBeInTheDocument();
    expect(screen.getByText(BOARD_NAME)).toBeInTheDocument();
    expect(screen.getByText(CARD_TITLE)).toBeInTheDocument();
    // Section 2.1.1: a card row carries its board and list, and its label chips.
    expect(screen.getByText('in Website relaunch · To Do')).toBeInTheDocument();
    expect(screen.getByTitle('Bug fix')).toBeInTheDocument();
  });

  it('walks the rows with the arrow keys and opens the highlighted one with Enter', async () => {
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole('textbox', { name: 'Search' }));
    await user.keyboard('launch');
    expect(await screen.findByText(CARD_TITLE)).toBeInTheDocument();

    // Boards come first, so the first ArrowDown lands on the card row below it.
    await user.keyboard('{ArrowDown}{Enter}');

    expect(await screen.findByText('at /b/7/c/101')).toBeInTheDocument();
  });

  it('sends nothing for one character and prints the empty state for a miss', async () => {
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole('textbox', { name: 'Search' }));
    await user.keyboard('l');
    expect(screen.queryByRole('heading', { name: 'Cards' })).not.toBeInTheDocument();

    await user.keyboard('zzz');

    expect(
      await screen.findByText("We couldn't find anything matching 'lzzz'"),
    ).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole('textbox', { name: 'Search' }));
    await user.keyboard('launch');
    expect(await screen.findByText(CARD_TITLE)).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByText(CARD_TITLE)).not.toBeInTheDocument();
    expect(useUiStore.getState().openPopover).toBeNull();
  });
});
