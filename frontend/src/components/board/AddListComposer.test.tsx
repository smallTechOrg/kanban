import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CreateListInput } from '@/api/lists';
import { useUiStore } from '@/store/uiStore';
import { makeListOut } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { AddListComposer } from './AddListComposer';

const BOARD_ID = 7;

/** Records the creates, so the assertions look at the request rather than the hook. */
function recordCreates(): CreateListInput[] {
  const calls: CreateListInput[] = [];
  server.use(
    http.post('/api/boards/:boardId/lists', async ({ request }) => {
      const input = (await request.json()) as CreateListInput;
      calls.push(input);
      const item = makeListOut({ id: 21, name: input.name, position: 3 * 65536 });
      return HttpResponse.json({ item, board_version: 2 }, { status: 201 });
    }),
  );
  return calls;
}

function renderComposer(isEmptyBoard = false): void {
  renderWithProviders(
    <AddListComposer boardId={BOARD_ID} isEmptyBoard={isEmptyBoard} />,
    `/b/${BOARD_ID}`,
  );
}

const TITLE_FIELD = { name: 'List title' };

describe('AddListComposer', () => {
  beforeEach(() => {
    useUiStore.setState({ composer: null, openPopover: null });
  });

  it('starts collapsed on a board that already has lists', () => {
    renderComposer();

    expect(screen.getByRole('button', { name: 'Add another list' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', TITLE_FIELD)).not.toBeInTheDocument();
  });

  it('opens itself on a board with no lists, under the first-list label', () => {
    renderComposer(true);

    expect(screen.getByRole('textbox', TITLE_FIELD)).toHaveAttribute(
      'placeholder',
      'Enter list title…',
    );
  });

  it('submits on Enter and stays open for the next list', async () => {
    const user = userEvent.setup();
    const calls = recordCreates();
    renderComposer();

    await user.click(screen.getByRole('button', { name: 'Add another list' }));
    await user.type(screen.getByRole('textbox', TITLE_FIELD), 'Backlog{Enter}');

    expect(calls).toEqual([{ name: 'Backlog' }]);
    const field = screen.getByRole('textbox', TITLE_FIELD);
    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
  });

  it('ignores an empty title', async () => {
    const user = userEvent.setup();
    const calls = recordCreates();
    renderComposer();

    await user.click(screen.getByRole('button', { name: 'Add another list' }));
    await user.type(screen.getByRole('textbox', TITLE_FIELD), '   {Enter}');

    expect(calls).toEqual([]);
    expect(screen.getByRole('textbox', TITLE_FIELD)).toBeInTheDocument();
  });

  it('closes on Escape and discards the draft', async () => {
    const user = userEvent.setup();
    const calls = recordCreates();
    renderComposer();

    await user.click(screen.getByRole('button', { name: 'Add another list' }));
    await user.type(screen.getByRole('textbox', TITLE_FIELD), 'Backlog{Escape}');

    expect(calls).toEqual([]);
    expect(screen.getByRole('button', { name: 'Add another list' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add another list' }));
    expect(screen.getByRole('textbox', TITLE_FIELD)).toHaveValue('');
  });

  it('closes on a click outside', async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(screen.getByRole('button', { name: 'Add another list' }));
    expect(screen.getByRole('textbox', TITLE_FIELD)).toBeInTheDocument();

    await user.click(document.body);

    expect(screen.getByRole('button', { name: 'Add another list' })).toBeInTheDocument();
  });
});
