import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CreateCardInput } from '@/api/cards';
import { makeCardSummary } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { CardComposer } from './CardComposer';

/** The fixture board: list 11 holds two active cards, and label 32 is named "Bug fix". */
const BOARD_ID = 7;
const LIST_ID = 11;
const BUG_FIX_LABEL = 32;

/** Captures what the composer posts, so the tests assert the request and not the hook. */
function recordCreates(): CreateCardInput[] {
  const bodies: CreateCardInput[] = [];
  server.use(
    http.post('/api/lists/:listId/cards', async ({ request }) => {
      const input = (await request.json()) as CreateCardInput;
      bodies.push(input);
      if (input.split_lines === true) {
        const lines = input.title.split('\n').filter((line) => line.trim() !== '');
        return HttpResponse.json({
          items: lines.map((line, at) =>
            makeCardSummary({ id: 900 + at, list_id: LIST_ID, title: line.trim() }),
          ),
          board_version: 2,
        });
      }
      const item = makeCardSummary({
        id: 900,
        list_id: LIST_ID,
        title: input.title,
        label_ids: input.label_ids ?? [],
      });
      return HttpResponse.json(
        { item: { ...item, client_id: input.client_id }, board_version: 2 },
        { status: 201 },
      );
    }),
  );
  return bodies;
}

function renderComposer(onClose = vi.fn()): { onClose: () => void; input: HTMLElement } {
  renderWithProviders(
    <CardComposer boardId={BOARD_ID} listId={LIST_ID} onClose={onClose} />,
    `/b/${BOARD_ID}`,
  );
  return { onClose, input: screen.getByLabelText('Card title') };
}

describe('CardComposer', () => {
  it('submits on Enter and stays open, focused and empty for the next card', async () => {
    const user = userEvent.setup();
    const bodies = recordCreates();
    const { input } = renderComposer();

    await user.type(input, 'Buy milk');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]?.title).toBe('Buy milk');
    expect(bodies[0]?.client_id).toMatch(/^tmp_[A-Za-z0-9]{1,32}$/);
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();

    await user.type(input, 'Buy bread');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]?.title).toBe('Buy bread');
  });

  it('inserts a newline on Shift+Enter without submitting', async () => {
    const user = userEvent.setup();
    const bodies = recordCreates();
    const { input } = renderComposer();

    await user.type(input, 'First{Shift>}{Enter}{/Shift}Second');

    expect(input).toHaveValue('First\nSecond');
    expect(bodies).toHaveLength(0);
  });

  it('submits on Ctrl+Enter as well', async () => {
    const user = userEvent.setup();
    const bodies = recordCreates();
    const { input } = renderComposer();

    await user.type(input, 'Write the brief');
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]?.title).toBe('Write the brief');
  });

  it('strips the tokens it previews and sends them as labels and a slot', async () => {
    const user = userEvent.setup();
    const bodies = recordCreates();
    const { input } = renderComposer();

    await user.type(input, 'Fix the header #Bug fix ^top');

    // The chip only appears once the board's labels have resolved and the token matched one.
    expect(await screen.findByText('Bug fix')).toBeInTheDocument();

    await user.keyboard('{Enter}');

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      title: 'Fix the header',
      label_ids: [BUG_FIX_LABEL],
      index: 'top',
    });
  });

  it('asks about a multi-line paste and sends it as one split_lines request', async () => {
    const user = userEvent.setup();
    const bodies = recordCreates();
    const { input } = renderComposer();

    await user.click(input);
    await user.paste('Alpha\nBeta\nGamma');

    // The paste itself never lands in the textarea: the composer asks first.
    expect(await screen.findByText('Create 3 cards?')).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(bodies).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Create 3 cards' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ split_lines: true, title: 'Alpha\nBeta\nGamma' });
    expect(input).toHaveValue('');
  });

  it('keeps a multi-line paste as a single editable title when asked to', async () => {
    const user = userEvent.setup();
    const bodies = recordCreates();
    const { input } = renderComposer();

    await user.click(input);
    await user.paste('Alpha\nBeta');
    await user.click(await screen.findByRole('button', { name: 'Just one card' }));

    expect(input).toHaveValue('Alpha Beta');
    expect(bodies).toHaveLength(0);
  });

  it('ignores an empty title', async () => {
    const user = userEvent.setup();
    const bodies = recordCreates();
    const { input } = renderComposer();

    await user.type(input, '   ');
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Add card' }));

    expect(bodies).toHaveLength(0);
  });

  it('closes on Escape and on the X, discarding the draft', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { input } = renderComposer(onClose);

    await user.type(input, 'Never saved');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Close composer' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
