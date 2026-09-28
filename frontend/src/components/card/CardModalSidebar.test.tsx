import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { CardDetail } from '@/api/types';
import { ToastViewport } from '@/components/ui';
import { boardKey } from '@/hooks/useBoardData';
import { cardKey } from '@/hooks/useCard';
import { useToast, useToasts } from '@/hooks/useToast';
import { normalizeBoard } from '@/lib/normalize';
import { useUiStore } from '@/store/uiStore';
import {
  boardGroupsFixture,
  boardPayloadFixture,
  makeBoardSummary,
  makeCardDetail,
  makeCardSummary,
  metaFixture,
  userFixture,
} from '@/test/handlers';
import { server } from '@/test/server';
import { CardModalSidebar } from './CardModalSidebar';

const BOARD_ID = 7;
const CARD_ID = 101;

/**
 * Every row of Section 2.6.4 that this milestone turns on, plus the three that were already
 * live: not one of them may be disabled behind a "Coming soon" tooltip any more.
 */
const ROWS = [
  'Join',
  'Members',
  'Labels',
  'Checklist',
  'Dates',
  'Attachment',
  'Cover',
  'Move',
  'Copy',
  'Make template',
  'Watch',
  'Archive',
  'Share',
];

/** Every write the sidebar can make, in the order it made them. */
function recordWrites(): string[] {
  const calls: string[] = [];
  server.use(
    http.put('/api/cards/:cardId/members/:userId', ({ params }) => {
      calls.push(`JOIN ${String(params['userId'])}`);
      return HttpResponse.json({ member_ids: [Number(params['userId'])], board_version: 2 });
    }),
    http.put('/api/cards/:cardId/watch', () => {
      calls.push('WATCH');
      return HttpResponse.json({ is_watching: true });
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
    http.delete('/api/cards/:cardId', ({ params }) => {
      calls.push(`DELETE ${String(params['cardId'])}`);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

/** A card nobody has joined, so the "Join" row of Section 2.6.4 renders. */
function card(overrides: Partial<CardDetail> = {}): CardDetail {
  return makeCardDetail({ id: CARD_ID, member_ids: [], ...overrides });
}

function seed(detail: CardDetail): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(['meta'], metaFixture);
  client.setQueryData(['boards'], boardGroupsFixture);
  client.setQueryData(cardKey(CARD_ID), detail);
  client.setQueryData(
    boardKey(BOARD_ID),
    normalizeBoard({
      ...boardPayloadFixture,
      board: makeBoardSummary({ id: BOARD_ID }),
      cards: [
        makeCardSummary({
          id: CARD_ID,
          member_ids: detail.member_ids,
          is_archived: detail.is_archived,
          is_watching: detail.is_watching,
        }),
      ],
    }),
  );
  return client;
}

function Host({ detail }: { detail: CardDetail }): JSX.Element {
  const { dismiss } = useToast();
  const toasts = useToasts();
  return (
    <>
      <CardModalSidebar card={detail} />
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

function open(detail: CardDetail = card()): void {
  render(
    <QueryClientProvider client={seed(detail)}>
      <MemoryRouter initialEntries={[`/b/${BOARD_ID}/c/${CARD_ID}`]}>
        <Routes>
          <Route path="/b/:boardId/c/:cardId" element={<Host detail={detail} />} />
          <Route path="/b/:boardId" element={<p>Board</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Which popover is open is a store field, so it is put back for the next test (Section 5.13).
afterEach(() => {
  act(() => {
    useUiStore.getState().setOpenPopover(null);
  });
});

describe('CardModalSidebar', () => {
  it('renders every row of Section 2.6.4 live', async () => {
    open();

    // "Join" needs to know who I am before it can render (`GET /api/auth/me`).
    for (const label of ROWS) {
      expect(await screen.findByRole('button', { name: label })).toBeEnabled();
    }
  });

  it('opens the Move, Copy and Share panels from their own rows', async () => {
    const user = userEvent.setup();
    open();

    // Each panel traps focus and hides the column behind it, so one is dismissed before the
    // next row is reached — which is also Section 2.6.5's "Esc closes the topmost popover first".
    await user.click(screen.getByRole('button', { name: 'Move' }));
    expect(
      within(await screen.findByRole('dialog')).getByLabelText('Position'),
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Create card' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText(`Card #${makeCardSummary().short_id}`)).toBeInTheDocument();
  });

  it('joins the card and starts watching it', async () => {
    const user = userEvent.setup();
    const calls = recordWrites();
    open();

    await user.click(await screen.findByRole('button', { name: 'Join' }));
    await waitFor(() => expect(calls).toEqual([`JOIN ${userFixture.id}`]));

    await user.click(screen.getByRole('button', { name: 'Watch' }));
    await waitFor(() => expect(calls).toEqual([`JOIN ${userFixture.id}`, 'WATCH']));
  });

  it('archives with the Undo toast that sends the card back', async () => {
    const user = userEvent.setup();
    const calls = recordWrites();
    open();

    await user.click(screen.getByRole('button', { name: 'Archive' }));

    expect(await screen.findByText('Card archived')).toBeInTheDocument();
    await waitFor(() => expect(calls).toEqual([`ARCHIVE ${CARD_ID}`]));

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(calls).toEqual([`ARCHIVE ${CARD_ID}`, `UNARCHIVE ${CARD_ID}`]));
  });

  it('offers "Send to board" and a confirmed Delete once the card is archived', async () => {
    const user = userEvent.setup();
    const calls = recordWrites();
    open(card({ is_archived: true }));

    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send to board' }));
    await waitFor(() => expect(calls).toEqual([`UNARCHIVE ${CARD_ID}`]));

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/There is no undo/)).toBeInTheDocument();
    expect(calls).toEqual([`UNARCHIVE ${CARD_ID}`]);

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(calls).toEqual([`UNARCHIVE ${CARD_ID}`, `DELETE ${CARD_ID}`]));
    expect(await screen.findByText('Board')).toBeInTheDocument();
  });
});
