import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Attachment, AttachmentKind, CardDetail } from '@/api/types';
import type { CoverInput } from '@/api/attachments';
import { cardKey, useCardDetail } from '@/hooks/useCard';
import { boardKey } from '@/hooks/useBoardData';
import { normalizeBoard } from '@/lib/normalize';
import {
  attachmentFixtures,
  boardPayloadFixture,
  makeBoardSummary,
  makeCardDetail,
  metaFixture,
} from '@/test/handlers';
import { server } from '@/test/server';
import { AttachmentsSection } from './AttachmentsSection';

const BOARD_ID = 7;
const CARD_ID = 101;
/** The fixture row of each kind, without indexing past the end of the array. */
function attachment(kind: AttachmentKind): Attachment {
  const row = attachmentFixtures.find((candidate) => candidate.kind === kind);
  if (row === undefined) throw new Error(`fixture attachment ${kind} missing`);
  return row;
}

/** The two fixture rows on card 101: an image, which may become the cover, and a link. */
const IMAGE = attachment('upload');
const LINK = attachment('link');

/** Every attachment and cover write the section can make, in the order it made them. */
function recordWrites(): string[] {
  const calls: string[] = [];
  server.use(
    http.delete('/api/attachments/:attachmentId', ({ params }) => {
      calls.push(`DELETE ${String(params['attachmentId'])}`);
      return new HttpResponse(null, { status: 204 });
    }),
    http.put('/api/cards/:cardId/cover', async ({ request }) => {
      const input = (await request.json()) as CoverInput;
      calls.push(`COVER ${input.kind}:${input.value}:${String(input.size)}`);
      return HttpResponse.json({
        item: { ...card(), cover: { kind: input.kind, value: input.value, size: 'normal' } },
        board_version: 2,
      });
    }),
    http.post('/api/cards/:cardId/attachments', async ({ request }) => {
      const body = (await request.json()) as { url: string; name?: string };
      calls.push(`LINK ${body.url}`);
      return HttpResponse.json(
        {
          item: { ...LINK, id: 412, url: body.url, name: body.name ?? body.url },
          board_version: 2,
        },
        { status: 201 },
      );
    }),
  );
  return calls;
}

/** One row of the list, found by the filename it shows, so the actions are scoped to it. */
function rowFor(name: string): HTMLElement {
  const row = screen.getByRole('link', { name }).closest('li');
  if (row === null) throw new Error(`no attachment row for ${name}`);
  return row;
}

function card(attachments = attachmentFixtures): CardDetail {
  return makeCardDetail({ id: CARD_ID, attachments });
}

/** The two caches the section reads: the card document and the board payload behind the tile. */
function seed(detail: CardDetail): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  client.setQueryData(['meta'], metaFixture);
  client.setQueryData(cardKey(CARD_ID), detail);
  client.setQueryData(
    boardKey(BOARD_ID),
    normalizeBoard({ ...boardPayloadFixture, board: makeBoardSummary({ id: BOARD_ID }) }),
  );
  return client;
}

/**
 * The section takes its card as a prop, as every other part of the modal does, so the host
 * subscribes to `['card', id]` the way `CardDetailModal` does — which is what makes the
 * optimistic patches of the delete and cover writes visible here.
 */
function Host(): ReactElement | null {
  const detail = useCardDetail(CARD_ID).data;
  if (detail === undefined) return null;
  return <AttachmentsSection boardId={BOARD_ID} card={detail} />;
}

function open(detail: CardDetail = card()): void {
  server.use(http.get('/api/cards/:cardId', () => HttpResponse.json(detail)));
  render(
    <QueryClientProvider client={seed(detail)}>
      <Host />
    </QueryClientProvider>,
  );
}

/**
 * The same section inside a dialog, which is what the drop zone of Section 5.8 listens on: the
 * card modal is a `[role="dialog"]`, and dropping files anywhere on it uploads them.
 */
function openInDialog(detail: CardDetail = card([])): HTMLElement {
  server.use(http.get('/api/cards/:cardId', () => HttpResponse.json(detail)));
  render(
    <QueryClientProvider client={seed(detail)}>
      <div role="dialog" aria-label="Card">
        <Host />
      </div>
    </QueryClientProvider>,
  );
  return screen.getByRole('dialog');
}

/** jsdom has no `DataTransfer`, so the event carries the two fields the handler reads. */
function filesPayload(files: File[]): { dataTransfer: { types: string[]; files: File[] } } {
  return { dataTransfer: { types: ['Files'], files } };
}

describe('AttachmentsSection', () => {
  it('lists each attachment with its meta line and the actions of its kind', () => {
    open();

    expect(screen.getByRole('link', { name: IMAGE.name })).toHaveAttribute('href', IMAGE.url);
    expect(screen.getByRole('link', { name: LINK.name })).toHaveAttribute('href', LINK.url);
    expect(screen.getAllByText(/^Added Sep 24/)).toHaveLength(attachmentFixtures.length);
    // Only an image may become a cover, so the link row offers no such action.
    expect(screen.getAllByRole('button', { name: 'Make cover' })).toHaveLength(1);
    // "LINK" stands in for a thumbnail the link kind has no file for.
    expect(screen.getByText('LINK')).toBeInTheDocument();
  });

  it('deletes a row through the confirm popover and removes it from the list', async () => {
    const user = userEvent.setup();
    const calls = recordWrites();
    open();

    await user.click(within(rowFor(IMAGE.name)).getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/Deleting an attachment is permanent/)).toBeInTheDocument();

    // The confirm popover's own red button, which is the only Delete inside that dialog.
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(calls).toEqual([`DELETE ${String(IMAGE.id)}`]));
    // The row goes with the optimistic patch, before the 204 lands.
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: IMAGE.name })).not.toBeInTheDocument(),
    );
  });

  it('makes an image the cover, and offers to remove it once it is one', async () => {
    const user = userEvent.setup();
    const calls = recordWrites();
    open();

    await user.click(screen.getByRole('button', { name: 'Make cover' }));

    await waitFor(() => expect(calls).toEqual([`COVER attachment:${String(IMAGE.id)}:normal`]));
    expect(await screen.findByRole('button', { name: 'Remove cover' })).toBeInTheDocument();
  });

  it('shows the empty state until the card has an attachment', () => {
    open(card([]));

    expect(screen.getByText(/No attachments yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make cover' })).not.toBeInTheDocument();
  });

  it('attaches a link from the popover its "Add" button opens', async () => {
    const user = userEvent.setup();
    const calls = recordWrites();
    open();

    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.type(await screen.findByLabelText('Link'), 'https://example.com/brief');
    await user.click(screen.getByRole('button', { name: 'Insert' }));

    await waitFor(() => expect(calls).toEqual(['LINK https://example.com/brief']));
  });

  it('uploads a file dropped anywhere on the open card', async () => {
    const dialog = openInDialog();
    const file = new File(['png bytes'], 'screenshot.png', { type: 'image/png' });

    fireEvent.dragOver(dialog, filesPayload([file]));
    expect(screen.getByText('Drop files to upload')).toBeInTheDocument();

    fireEvent.drop(dialog, filesPayload([file]));

    // The stored row replaces the pending one when the response lands: an upload has no
    // optimistic row to swap, because the id names the directory the bytes are stored in.
    await waitFor(() => {
      expect(screen.queryByText('Uploading…')).not.toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
    });
    expect(screen.queryByText(/No attachments yet/)).not.toBeInTheDocument();
    expect(screen.queryByText('Drop files to upload')).not.toBeInTheDocument();
  });

  it('ignores a drag that carries no files', () => {
    const dialog = openInDialog();

    fireEvent.dragOver(dialog, { dataTransfer: { types: ['text/plain'], files: [] } });

    expect(screen.queryByText('Drop files to upload')).not.toBeInTheDocument();
  });
});
