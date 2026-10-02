import { useState, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateCardInput } from '@/api/cards';
import { ToastViewport } from '@/components/ui';
import { boardKey } from '@/hooks/useBoardData';
import { useToast, useToasts } from '@/hooks/useToast';
import type { CardRow } from '@/lib/boardState';
import { normalizeBoard } from '@/lib/normalize';
import { useUiStore } from '@/store/uiStore';
import {
  boardPayloadFixture,
  makeBoardSummary,
  makeCardSummary,
  metaFixture,
} from '@/test/handlers';
import { server } from '@/test/server';
import { QuickCardEditor } from './QuickCardEditor';

const BOARD_ID = 7;
const CARD_ID = 101;

/** Every write the editor can make, in the order it made them. */
function recordWrites(): string[] {
  const calls: string[] = [];
  server.use(
    http.patch('/api/cards/:cardId', async ({ params, request }) => {
      const patch = (await request.json()) as UpdateCardInput;
      calls.push(`PATCH ${String(params['cardId'])} ${patch.title ?? ''}`);
      const item = makeCardSummary({ id: Number(params['cardId']), title: patch.title ?? '' });
      return HttpResponse.json({ item, board_version: 2 });
    }),
    http.post('/api/cards/:cardId/archive', ({ params }) => {
      calls.push(`ARCHIVE ${String(params['cardId'])}`);
      const item = makeCardSummary({ id: Number(params['cardId']), is_archived: true });
      return HttpResponse.json({ item, board_version: 2 });
    }),
    http.post('/api/cards/:cardId/unarchive', ({ params }) => {
      calls.push(`UNARCHIVE ${String(params['cardId'])}`);
      const item = makeCardSummary({ id: Number(params['cardId']) });
      return HttpResponse.json({ item, board_version: 3 });
    }),
  );
  return calls;
}

function card(): CardRow {
  const state = normalizeBoard({
    ...boardPayloadFixture,
    board: makeBoardSummary({ id: BOARD_ID }),
    cards: [makeCardSummary({ id: CARD_ID, title: 'Write launch announcement' })],
  });
  const row = state.cards[CARD_ID];
  if (row === undefined) throw new Error('fixture card missing');
  return row;
}

/** The editor is opened by a tile, so the test gives it a real element to clone over. */
function Host({ onClose }: { onClose: () => void }): ReactElement {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { dismiss } = useToast();
  const toasts = useToasts();
  return (
    <>
      <div ref={setAnchor} />
      {anchor === null ? null : (
        <QuickCardEditor boardId={BOARD_ID} card={card()} anchor={anchor} onClose={onClose} />
      )}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

function renderEditor(onClose = vi.fn()): () => void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(['meta'], metaFixture);
  client.setQueryData(
    boardKey(BOARD_ID),
    normalizeBoard({
      ...boardPayloadFixture,
      board: makeBoardSummary({ id: BOARD_ID }),
      cards: [makeCardSummary({ id: CARD_ID, title: 'Write launch announcement' })],
    }),
  );
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/b/${BOARD_ID}`]}>
        <Routes>
          <Route path={`/b/${BOARD_ID}`} element={<Host onClose={onClose} />} />
          <Route path={`/b/${BOARD_ID}/c/${CARD_ID}`} element={<p>Card modal</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onClose;
}

// Which popover is open is a store field, so it is put back for the next test (Section 5.13).
afterEach(() => {
  act(() => {
    useUiStore.getState().setOpenPopover(null);
  });
});

describe('QuickCardEditor', () => {
  it('saves the edited title on Enter and closes', async () => {
    const user = userEvent.setup();
    const calls = recordWrites();
    const onClose = renderEditor();

    const input = screen.getByLabelText('Card title');
    expect(input).toHaveValue('Write launch announcement');
    expect(input).toHaveFocus();

    await user.clear(input);
    await user.type(input, 'Write the launch post');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(calls).toEqual([`PATCH ${CARD_ID} Write the launch post`]));
    expect(onClose).toHaveBeenCalled();
  });

  it('saves from the Save button and skips the request when nothing changed', async () => {
    const user = userEvent.setup();
    const calls = recordWrites();
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(calls).toEqual([]);
  });

  it('cancels on Escape without saving', async () => {
    const user = userEvent.setup();
    const calls = recordWrites();
    const onClose = renderEditor();

    await user.type(screen.getByLabelText('Card title'), ' and post it');
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('navigates to the card from "Open card"', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Open card' }));

    expect(await screen.findByText('Card modal')).toBeInTheDocument();
  });

  it('renders every action of Section 2.5.4 live', () => {
    renderEditor();

    for (const label of ['Open card', 'Edit labels', 'Edit dates', 'Archive']) {
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
    }

    // Move, Copy and Change cover went with the panels they opened.
    for (const label of ['Move', 'Copy', 'Change cover']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });

  it('opens the Labels popover, which Escape closes before the editor', async () => {
    const user = userEvent.setup();
    const onClose = renderEditor();

    await user.click(screen.getByRole('button', { name: 'Edit labels' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Label Bug fix' })).toBeInTheDocument();

    // Section 2.6.5: the topmost popover closes first, and the editor stays open behind it.
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('opens the Dates popover from "Edit dates"', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Edit dates' }));

    expect(await screen.findByRole('checkbox', { name: 'Due date' })).toBeInTheDocument();
  });

  it('archives with an Undo toast that sends the card back', async () => {
    const user = userEvent.setup();
    const calls = recordWrites();
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Archive' }));

    expect(await screen.findByText('Card archived')).toBeInTheDocument();
    await waitFor(() => expect(calls).toEqual([`ARCHIVE ${CARD_ID}`]));

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(calls).toEqual([`ARCHIVE ${CARD_ID}`, `UNARCHIVE ${CARD_ID}`]));
  });
});
