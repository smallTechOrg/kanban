import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { UpdateCardInput } from '@/api/cards';
import { makeCardDetail, makeCardSummary } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { DescriptionEditor } from './DescriptionEditor';

const BOARD_ID = 7;
const EMPTY_PROMPT = 'Add a more detailed description…';

/** Every `PATCH /api/cards/{id}` body the editor sent, in order. */
function recordPatches(): (string | undefined)[] {
  const bodies: (string | undefined)[] = [];
  server.use(
    http.patch('/api/cards/:cardId', async ({ params, request }) => {
      const patch = (await request.json()) as UpdateCardInput;
      bodies.push(patch.description);
      const item = makeCardSummary({ id: Number(params['cardId']) });
      return HttpResponse.json({ item, board_version: 2 });
    }),
  );
  return bodies;
}

describe('DescriptionEditor', () => {
  it('saves the draft on Ctrl+Enter', async () => {
    const user = userEvent.setup();
    const patches = recordPatches();
    renderWithProviders(<DescriptionEditor boardId={BOARD_ID} card={makeCardDetail()} />);

    await user.click(screen.getByRole('button', { name: EMPTY_PROMPT }));
    const editor = screen.getByRole('textbox', { name: 'Description' });
    await user.type(editor, 'Ship it **today**');
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(patches).toEqual(['Ship it **today**']));
  });

  it('discards the draft on Cancel and writes nothing', async () => {
    const user = userEvent.setup();
    const patches = recordPatches();
    renderWithProviders(<DescriptionEditor boardId={BOARD_ID} card={makeCardDetail()} />);

    await user.click(screen.getByRole('button', { name: EMPTY_PROMPT }));
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'never mind');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // The empty state is back, so the stored description is still empty.
    expect(await screen.findByRole('button', { name: EMPTY_PROMPT })).toBeInTheDocument();
    expect(patches).toEqual([]);
  });

  it('renders a stored description as Markdown, with "Edit" to change it', async () => {
    const user = userEvent.setup();
    const card = makeCardDetail({ description: '# Plan\n\n- [ ] one\n\n<b>not bold</b>' });
    renderWithProviders(<DescriptionEditor boardId={BOARD_ID} card={card} />);

    expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument();
    // No rehype-raw: the HTML a user typed is text, and its checkbox is inert (Section 5.7).
    expect(screen.getByText('<b>not bold</b>')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(card.description);
  });
});
