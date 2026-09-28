import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Attachment, AttachmentKind, CardCover, CardDetail, Meta } from '@/api/types';
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
import { CardCoverStrip } from './CardCoverStrip';

const BOARD_ID = 7;
const CARD_ID = 101;
/** The fixture row of each kind, without indexing past the end of the array. */
function attachment(kind: AttachmentKind): Attachment {
  const row = attachmentFixtures.find((candidate) => candidate.kind === kind);
  if (row === undefined) throw new Error(`fixture attachment ${kind} missing`);
  return row;
}

const IMAGE = attachment('upload');

const META: Meta = { ...metaFixture, cover_colors: { green: 'var(--success)' } };

function open(cover: CardCover | null): CardDetail {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const detail = makeCardDetail({ id: CARD_ID, cover, attachments: attachmentFixtures });
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
  render(
    <QueryClientProvider client={client}>
      <CardCoverStrip boardId={BOARD_ID} card={detail} />
    </QueryClientProvider>,
  );
  return detail;
}

describe('CardCoverStrip', () => {
  it('renders nothing while the card has no cover', () => {
    open(null);

    expect(screen.queryByRole('button', { name: 'Cover' })).not.toBeInTheDocument();
  });

  it('opens the cover popover from the band’s own button', async () => {
    const user = userEvent.setup();
    open({ kind: 'color', value: 'green', size: 'normal' });

    await user.click(screen.getByRole('button', { name: 'Cover' }));

    expect(await screen.findByRole('button', { name: 'Remove cover' })).toBeInTheDocument();
  });

  it('leads with the thumbnail and keeps the original behind it until it has loaded', () => {
    const detail = open({
      kind: 'attachment',
      value: String(IMAGE.id),
      size: 'normal',
      image_url: IMAGE.thumb_url ?? '',
      dominant_color: 'var(--primary)',
    });

    // Section 2.6.1: the strip paints the original attachment, with the 512x256 thumbnail in
    // its place until that file has loaded — so both are in the box and only one is visible.
    const sources = screen.getAllByRole('presentation', { hidden: true });
    expect(sources.map((image) => image.getAttribute('src'))).toEqual([
      IMAGE.thumb_url,
      detail.attachments[0]?.url,
    ]);
  });
});
