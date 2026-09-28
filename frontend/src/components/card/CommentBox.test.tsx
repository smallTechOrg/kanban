import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Member } from '@/api/types';
import { boardKey } from '@/hooks/useBoardData';
import { normalizeBoard } from '@/lib/normalize';
import { boardPayloadFixture, makeBoardSummary, memberFixture } from '@/test/handlers';
import { server } from '@/test/server';
import { CommentBox } from './CommentBox';

const BOARD_ID = 7;
const CARD_ID = 101;

/** A second member, so `@a` has something to match that is not the signed-in user. */
const asha: Member = {
  ...memberFixture,
  id: 2,
  username: 'asha',
  full_name: 'Asha Rao',
  initials: 'AR',
  role: 'member',
};

/** The board cache as `BoardPage` leaves it: this board's two members. */
function seed(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  client.setQueryData(
    boardKey(BOARD_ID),
    normalizeBoard({
      ...boardPayloadFixture,
      board: makeBoardSummary({ id: BOARD_ID }),
      members: [memberFixture, asha],
    }),
  );
  return client;
}

/** The bodies `POST /api/cards/{card_id}/comments` was called with, in order. */
function recordPosts(): string[] {
  const bodies: string[] = [];
  server.use(
    http.post('/api/cards/:cardId/comments', async ({ request }) => {
      const { body } = (await request.json()) as { body: string };
      bodies.push(body);
      return new HttpResponse(null, { status: 500 });
    }),
  );
  return bodies;
}

function renderBox(): void {
  render(
    <QueryClientProvider client={seed()}>
      <CommentBox boardId={BOARD_ID} cardId={CARD_ID} />
    </QueryClientProvider>,
  );
}

async function openEditor(): Promise<HTMLElement> {
  const user = userEvent.setup();
  renderBox();
  await user.click(screen.getByRole('button', { name: 'Write a comment…' }));
  return screen.getByLabelText('Write a comment');
}

describe('CommentBox', () => {
  it('completes an @mention from the board members and keeps typing after it', async () => {
    const user = userEvent.setup();
    const input = await openEditor();

    await user.type(input, 'Ping @as');
    const list = await screen.findByRole('listbox', { name: 'Board members' });
    expect(screen.getByRole('option', { name: /Asha Rao/ })).toBeInTheDocument();
    // Vivek does not start with "as" and his name does not contain it, so one row only.
    expect(screen.getAllByRole('option')).toHaveLength(1);

    await user.click(screen.getByRole('option', { name: /Asha Rao/ }));
    await waitFor(() => expect(list).not.toBeInTheDocument());
    expect(input).toHaveValue('Ping @asha ');
  });

  it('picks the highlighted row with the arrow keys and Enter, which does not submit', async () => {
    const user = userEvent.setup();
    const posts = recordPosts();
    const input = await openEditor();

    await user.type(input, 'Hello @');
    expect(await screen.findAllByRole('option')).toHaveLength(2);

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /Asha Rao/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.keyboard('{Enter}');
    expect(input).toHaveValue('Hello @asha ');
    expect(posts).toEqual([]);
  });

  it('closes the mention list on Escape and keeps the draft', async () => {
    const user = userEvent.setup();
    const input = await openEditor();

    await user.type(input, 'Ask @as');
    expect(await screen.findByRole('listbox', { name: 'Board members' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('listbox', { name: 'Board members' })).not.toBeInTheDocument(),
    );
    expect(input).toHaveValue('Ask @as');
  });

  it('posts the comment on Ctrl+Enter and collapses the box', async () => {
    const user = userEvent.setup();
    const posts = recordPosts();
    const input = await openEditor();

    await user.type(input, '  Shipped it  ');
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(posts).toEqual(['Shipped it']));
    expect(await screen.findByRole('button', { name: 'Write a comment…' })).toBeInTheDocument();
  });

  it('sends nothing for a blank draft', async () => {
    const user = userEvent.setup();
    const posts = recordPosts();
    const input = await openEditor();

    await user.type(input, '   ');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(posts).toEqual([]);
    expect(input).toBeInTheDocument();
  });
});
