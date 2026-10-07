import { useState, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { UpdateCardInput } from '@/api/cards';
import type { CardDetail } from '@/api/types';
import { tomorrowNoon } from '@/lib/dates';
import { makeCardDetail, makeCardSummary } from '@/test/handlers';
import { server } from '@/test/server';
import { DatesPopover } from './DatesPopover';

const BOARD_ID = 7;
const CARD_ID = 101;

/** A due date in the future, stored as the ISO-8601 UTC instant the API keeps (Section 4.1). */
const DUE_AT = '2026-10-01T15:00:00.000Z';

/**
 * Serves the card the popover seeds itself from and collects every `PATCH` body it sends.
 * The answer is a `Mutated<CardSummary>`, which is what `useUpdateCardFields` writes back.
 */
function mount(detail: CardDetail): UpdateCardInput[] {
  const patches: UpdateCardInput[] = [];
  server.use(
    http.get('/api/cards/:cardId', () => HttpResponse.json(detail)),
    http.patch('/api/cards/:cardId', async ({ request }) => {
      patches.push((await request.json()) as UpdateCardInput);
      return HttpResponse.json({ item: makeCardSummary({ id: CARD_ID }), board_version: 2 });
    }),
  );

  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
        })
      }
    >
      <Host />
    </QueryClientProvider>,
  );
  return patches;
}

/** The popover is opened from a control, so the test gives it a real element to hang off. */
function Host(): ReactElement {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button type="button" ref={setAnchor}>
        Dates
      </button>
      {anchor === null ? null : (
        <DatesPopover
          boardId={BOARD_ID}
          cardId={CARD_ID}
          anchor={anchor}
          onClose={() => undefined}
        />
      )}
    </>
  );
}

describe('DatesPopover', () => {
  it('saves the due date the first tick offers, as a UTC instant', async () => {
    const user = userEvent.setup();
    const patches = mount(makeCardDetail({ id: CARD_ID }));

    // Section 2.6.5: enabling the due date for the first time offers tomorrow at 12:00 PM local.
    await user.click(await screen.findByRole('checkbox', { name: 'Due date' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      start_at: null,
      due_at: tomorrowNoon().toISOString(),
      due_reminder_minutes: null,
    });
  });

  it('keeps the stored due date and writes the reminder the select picked', async () => {
    const user = userEvent.setup();
    const patches = mount(makeCardDetail({ id: CARD_ID, due_at: DUE_AT }));

    const select = await screen.findByLabelText('Set due date reminder');
    await user.selectOptions(select, '60');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      start_at: null,
      due_at: DUE_AT,
      due_reminder_minutes: 60,
    });
  });

  it('clears both dates and the reminder with Remove', async () => {
    const user = userEvent.setup();
    const patches = mount(
      makeCardDetail({ id: CARD_ID, due_at: DUE_AT, due_reminder_minutes: 60 }),
    );

    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    // Only the three nullable columns may be nulled (Section 4.5).
    expect(patches[0]).toEqual({ start_at: null, due_at: null, due_reminder_minutes: null });
  });

  it('starts from the dates the card already has', async () => {
    const patches = mount(makeCardDetail({ id: CARD_ID, due_at: DUE_AT }));

    expect(await screen.findByRole('checkbox', { name: 'Due date' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Start date' })).not.toBeChecked();
    expect(patches).toHaveLength(0);
  });
});
