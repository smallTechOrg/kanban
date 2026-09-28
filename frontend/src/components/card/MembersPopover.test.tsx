import { useState, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Member } from '@/api/types';
import { boardKey } from '@/hooks/useBoardData';
import { normalizeBoard } from '@/lib/normalize';
import {
  boardPayloadFixture,
  makeBoardSummary,
  makeCardSummary,
  memberFixture,
  metaFixture,
} from '@/test/handlers';
import { server } from '@/test/server';
import { MembersPopover } from './MembersPopover';

const BOARD_ID = 7;
const CARD_ID = 101;
/** `userFixture` is the signed-in user, so member 1 is "me" and member 2 is somebody else. */
const ME = memberFixture.id;
const ASHA = 2;

const asha: Member = {
  id: ASHA,
  username: 'asha',
  full_name: 'Asha Patel',
  initials: 'AP',
  avatar_color: 'var(--success)',
  role: 'member',
  joined_at: '2026-09-02T09:00:00.000Z',
};

/**
 * Every assignment write the popover can make, in the order it made them. The handler keeps the
 * card's own list the way the server does — both verbs answer with the whole `member_ids` array
 * (Section 4.5) — so a second click acts on the state the first one left.
 */
function recordWrites(initial: number[]): string[] {
  const calls: string[] = [];
  const ids = new Set(initial);
  server.use(
    http.put('/api/cards/:cardId/members/:userId', ({ params }) => {
      const userId = Number(params['userId']);
      calls.push(`ASSIGN ${String(userId)}`);
      ids.add(userId);
      return HttpResponse.json({ member_ids: [...ids], board_version: 2 });
    }),
    http.delete('/api/cards/:cardId/members/:userId', ({ params }) => {
      const userId = Number(params['userId']);
      calls.push(`UNASSIGN ${String(userId)}`);
      ids.delete(userId);
      return HttpResponse.json({ member_ids: [...ids], board_version: 2 });
    }),
  );
  return calls;
}

/** The board cache as `BoardPage` leaves it: two members, and who the card carries. */
function seed(memberIds: number[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  client.setQueryData(['meta'], metaFixture);
  client.setQueryData(
    boardKey(BOARD_ID),
    normalizeBoard({
      ...boardPayloadFixture,
      board: makeBoardSummary({ id: BOARD_ID }),
      members: [memberFixture, asha],
      cards: [makeCardSummary({ id: CARD_ID, member_ids: memberIds })],
    }),
  );
  return client;
}

/** The popover is opened from a control, so the test gives it a real element to hang off. */
function Host(): ReactElement {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button type="button" ref={setAnchor}>
        Members
      </button>
      {anchor === null ? null : (
        <MembersPopover
          boardId={BOARD_ID}
          cardId={CARD_ID}
          anchor={anchor}
          onClose={() => undefined}
        />
      )}
    </>
  );
}

function open(memberIds: number[]): void {
  render(
    <QueryClientProvider client={seed(memberIds)}>
      <Host />
    </QueryClientProvider>,
  );
}

describe('MembersPopover', () => {
  it('assigns a board member and unassigns a card member from the same rows', async () => {
    const user = userEvent.setup();
    const calls = recordWrites([ME]);
    open([ME]);

    const mine = await screen.findByRole('button', { name: memberFixture.full_name });
    expect(mine).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Card members')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: asha.full_name })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await user.click(screen.getByRole('button', { name: asha.full_name }));
    await waitFor(() => expect(calls).toEqual([`ASSIGN ${String(ASHA)}`]));
    // The row is pressed before the server answers: the board cache was patched optimistically.
    expect(screen.getByRole('button', { name: asha.full_name })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: memberFixture.full_name }));
    await waitFor(() =>
      expect(calls).toEqual([`ASSIGN ${String(ASHA)}`, `UNASSIGN ${String(ME)}`]),
    );
    expect(screen.getByRole('button', { name: memberFixture.full_name })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('offers Join while I am not on the card and assigns me', async () => {
    const user = userEvent.setup();
    const calls = recordWrites([]);
    open([]);

    await user.click(await screen.findByRole('button', { name: 'Join' }));

    await waitFor(() => expect(calls).toEqual([`ASSIGN ${String(ME)}`]));
    // Joining makes me a card member, so the one control for that state goes away.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Join' })).not.toBeInTheDocument(),
    );
  });

  it('hides Join from somebody who is already a card member', async () => {
    open([ME]);

    await screen.findByRole('button', { name: memberFixture.full_name });
    expect(screen.queryByRole('button', { name: 'Join' })).not.toBeInTheDocument();
  });

  it('filters the rows by the name or username the search box holds', async () => {
    const user = userEvent.setup();
    open([ME]);

    await user.type(await screen.findByLabelText('Search members'), 'asha');

    expect(screen.getByRole('button', { name: asha.full_name })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: memberFixture.full_name })).not.toBeInTheDocument();
  });
});
