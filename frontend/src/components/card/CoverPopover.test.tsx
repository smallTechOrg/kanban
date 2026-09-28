import { useState, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Attachment, AttachmentKind, CardCover, CardDetail, Meta } from '@/api/types';
import type { CoverInput } from '@/api/attachments';
import { boardKey } from '@/hooks/useBoardData';
import { cardKey } from '@/hooks/useCard';
import { normalizeBoard } from '@/lib/normalize';
import {
  attachmentFixtures,
  boardPayloadFixture,
  makeBoardSummary,
  makeCardDetail,
  makeCardSummary,
  metaFixture,
} from '@/test/handlers';
import { server } from '@/test/server';
import { CoverPopover } from './CoverPopover';

const BOARD_ID = 7;
const CARD_ID = 101;
/** The fixture row of each kind, without indexing past the end of the array. */
function attachment(kind: AttachmentKind): Attachment {
  const row = attachmentFixtures.find((candidate) => candidate.kind === kind);
  if (row === undefined) throw new Error(`fixture attachment ${kind} missing`);
  return row;
}

const IMAGE = attachment('upload');

/** The palette the swatches are built from is the server's, so the test supplies two keys. */
const META: Meta = {
  ...metaFixture,
  cover_colors: { green: 'var(--success)', blue: 'var(--primary)' },
};

/** Every cover write the panel can make, in the order it made them. */
function recordWrites(): string[] {
  const calls: string[] = [];
  server.use(
    http.put('/api/cards/:cardId/cover', async ({ request }) => {
      const input = (await request.json()) as CoverInput;
      calls.push(`SET ${input.kind}:${input.value}:${String(input.size)}`);
      return HttpResponse.json({
        item: makeCardSummary({
          id: CARD_ID,
          cover: { kind: input.kind, value: input.value, size: input.size ?? 'normal' },
        }),
        board_version: 2,
      });
    }),
    http.delete('/api/cards/:cardId/cover', () => {
      calls.push('CLEAR');
      return HttpResponse.json({
        item: makeCardSummary({ id: CARD_ID, cover: null }),
        board_version: 2,
      });
    }),
  );
  return calls;
}

function seed(cover: CardCover | null): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const detail: CardDetail = makeCardDetail({
    id: CARD_ID,
    cover,
    attachments: attachmentFixtures,
  });
  server.use(http.get('/api/cards/:cardId', () => HttpResponse.json(detail)));
  client.setQueryData(['meta'], META);
  client.setQueryData(cardKey(CARD_ID), detail);
  client.setQueryData(
    boardKey(BOARD_ID),
    normalizeBoard({
      ...boardPayloadFixture,
      board: makeBoardSummary({ id: BOARD_ID }),
      cards: [makeCardSummary({ id: CARD_ID, cover })],
    }),
  );
  return client;
}

function Host({ cover }: { cover: CardCover | null }): ReactElement {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <QueryClientProvider client={seed(cover)}>
      <button type="button" ref={setAnchor}>
        Cover
      </button>
      {anchor === null ? null : (
        <CoverPopover
          boardId={BOARD_ID}
          cardId={CARD_ID}
          anchor={anchor}
          onClose={() => undefined}
        />
      )}
    </QueryClientProvider>
  );
}

function open(cover: CardCover | null = null): void {
  render(<Host cover={cover} />);
}

describe('CoverPopover', () => {
  it("sets a colour cover from the server's palette", async () => {
    const user = userEvent.setup();
    const calls = recordWrites();
    open();

    await user.click(await screen.findByRole('button', { name: 'green' }));

    await waitFor(() => expect(calls).toEqual(['SET color:green:normal']));
    expect(screen.getByRole('button', { name: 'green' })).toHaveAttribute('aria-pressed', 'true');
  });

  it("sets an image cover from one of the card's own attachments", async () => {
    const user = userEvent.setup();
    const calls = recordWrites();
    open();

    await user.click(await screen.findByRole('button', { name: `Cover from ${IMAGE.name}` }));

    await waitFor(() => expect(calls).toEqual([`SET attachment:${String(IMAGE.id)}:normal`]));
  });

  it('rewrites the cover it has when the full-size tile is picked', async () => {
    const user = userEvent.setup();
    const calls = recordWrites();
    open({ kind: 'color', value: 'blue', size: 'normal' });

    expect(await screen.findByRole('button', { name: 'Normal cover' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Full cover' }));

    await waitFor(() => expect(calls).toEqual(['SET color:blue:full']));
  });

  it('removes the cover, and offers neither size nor removal without one', async () => {
    const user = userEvent.setup();
    const calls = recordWrites();
    open({ kind: 'color', value: 'green', size: 'normal' });

    await user.click(await screen.findByRole('button', { name: 'Remove cover' }));

    await waitFor(() => expect(calls).toEqual(['CLEAR']));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove cover' })).toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: 'Full cover' })).toBeDisabled();
  });
});
