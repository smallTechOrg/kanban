import { useState, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { LabelColor, Meta } from '@/api/types';
import { boardKey } from '@/hooks/useBoardData';
import { normalizeBoard } from '@/lib/normalize';
import {
  boardPayloadFixture,
  labelFixtures,
  makeBoardSummary,
  makeCardSummary,
  metaFixture,
} from '@/test/handlers';
import { server } from '@/test/server';
import { LabelsPopover } from './LabelsPopover';

/**
 * `metaFixture` fills in only the `none` palette row, and the swatch grid is built from the
 * palette's keys, so this test supplies the two rows its labels use. The values are tokens
 * rather than hexes: the fixture is a stand-in for the server's answer, not a second palette.
 */
const row: LabelColor = {
  subtle: 'var(--hover)',
  normal: 'var(--success)',
  bold: 'var(--primary)',
  text: 'var(--text)',
  text_bold: 'var(--text-inverse)',
};

const META: Meta = {
  ...metaFixture,
  label_colors: { green: row, red: row, none: row },
};

const BOARD_ID = 7;
const CARD_ID = 101;
/** The two fixture labels: unnamed green, which this card carries, and "Bug fix", which it does not. */
const GREEN = 31;
const BUG_FIX = 32;

/** Every label write the popover can make, in the order it made them. */
function recordWrites(): string[] {
  const calls: string[] = [];
  server.use(
    http.put('/api/cards/:cardId/labels/:labelId', ({ params }) => {
      calls.push(`ATTACH ${String(params['labelId'])}`);
      return HttpResponse.json({ label_ids: [GREEN, BUG_FIX], board_version: 2 });
    }),
    http.delete('/api/cards/:cardId/labels/:labelId', ({ params }) => {
      calls.push(`DETACH ${String(params['labelId'])}`);
      return HttpResponse.json({ label_ids: [], board_version: 2 });
    }),
    http.delete('/api/labels/:labelId', ({ params }) => {
      calls.push(`DELETE ${String(params['labelId'])}`);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

/** The board cache as `BoardPage` leaves it: the palette, the labels and the card. */
function seed(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  client.setQueryData(['meta'], META);
  client.setQueryData(
    boardKey(BOARD_ID),
    normalizeBoard({
      ...boardPayloadFixture,
      board: makeBoardSummary({ id: BOARD_ID }),
      labels: labelFixtures,
      cards: [makeCardSummary({ id: CARD_ID, label_ids: [GREEN] })],
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
        Labels
      </button>
      {anchor === null ? null : (
        <LabelsPopover
          boardId={BOARD_ID}
          cardId={CARD_ID}
          anchor={anchor}
          onClose={() => undefined}
        />
      )}
    </>
  );
}

function open(): void {
  render(
    <QueryClientProvider client={seed()}>
      <Host />
    </QueryClientProvider>,
  );
}

describe('LabelsPopover', () => {
  it('attaches a label the card lacks and detaches one it carries', async () => {
    const user = userEvent.setup();
    const calls = recordWrites();
    open();

    const green = await screen.findByRole('button', { name: 'Label green' });
    expect(green).toHaveAttribute('aria-pressed', 'true');
    const bugFix = screen.getByRole('button', { name: 'Label Bug fix' });
    expect(bugFix).toHaveAttribute('aria-pressed', 'false');

    await user.click(bugFix);
    await waitFor(() => expect(calls).toEqual([`ATTACH ${String(BUG_FIX)}`]));
    // The chip is pressed before the server answers: the board cache was patched optimistically.
    expect(screen.getByRole('button', { name: 'Label Bug fix' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Label green' }));
    await waitFor(() =>
      expect(calls).toEqual([`ATTACH ${String(BUG_FIX)}`, `DETACH ${String(GREEN)}`]),
    );
    expect(screen.getByRole('button', { name: 'Label green' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('filters the rows by the name the search box holds', async () => {
    const user = userEvent.setup();
    open();

    await user.type(await screen.findByLabelText('Search labels'), 'bug');

    expect(screen.getByRole('button', { name: 'Label Bug fix' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Label green' })).not.toBeInTheDocument();
  });

  it('offers Delete on the edit view and deletes through the confirm', async () => {
    const user = userEvent.setup();
    const calls = recordWrites();
    open();

    await user.click(await screen.findByRole('button', { name: 'Edit label Bug fix' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/This will remove this label from all cards/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls).toEqual([`DELETE ${String(BUG_FIX)}`]));
  });

  it('writes the name, colour and tone the create view picked', async () => {
    const user = userEvent.setup();
    const created: unknown[] = [];
    server.use(
      http.post('/api/boards/:boardId/labels', async ({ request }) => {
        created.push(await request.json());
        return HttpResponse.json(
          {
            item: {
              id: 33,
              board_id: BOARD_ID,
              name: 'Blocked',
              color: 'red',
              tone: 'bold',
              position: 3,
            },
            board_version: 2,
          },
          { status: 201 },
        );
      }),
    );
    open();

    await user.click(await screen.findByRole('button', { name: 'Create a new label' }));
    await user.type(screen.getByLabelText('Title'), 'Blocked');
    // The grid is the server's palette, so the swatch is named by its key and tone.
    await user.click(screen.getByRole('button', { name: 'red bold' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(created).toEqual([{ name: 'Blocked', color: 'red', tone: 'bold' }]));
  });
});
