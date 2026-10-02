import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateListInput } from '@/api/lists';
import { useUiStore } from '@/store/uiStore';
import { makeListOut } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { ListHeader } from './ListHeader';

const BOARD_ID = 7;
const LIST_ID = 11;

/** Records the renames so the assertions look at the request, not at the hook. */
function recordRenames(): UpdateListInput[] {
  const calls: UpdateListInput[] = [];
  server.use(
    http.patch('/api/lists/:listId', async ({ request }) => {
      const input = (await request.json()) as UpdateListInput;
      calls.push(input);
      const item = makeListOut({ id: LIST_ID, name: input.name ?? 'To Do' });
      return HttpResponse.json({ item, board_version: 2 });
    }),
  );
  return calls;
}

function renderHeader(): void {
  renderWithProviders(
    <ListHeader
      boardId={BOARD_ID}
      listId={LIST_ID}
      name="To Do"
      cardCount={2}
      handleProps={null}
    />,
    `/b/${BOARD_ID}`,
  );
}

describe('ListHeader', () => {
  beforeEach(() => {
    useUiStore.setState({ openPopover: null, composer: null });
  });

  it('shows the list name and its card count', () => {
    renderHeader();

    expect(screen.getByRole('button', { name: 'Rename list To Do' })).toHaveTextContent('To Do');
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('commits the rename on Enter', async () => {
    const user = userEvent.setup();
    const calls = recordRenames();
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Rename list To Do' }));
    const editor = screen.getByRole('textbox', { name: 'Rename list To Do' });
    await user.clear(editor);
    await user.type(editor, 'Backlog{Enter}');

    expect(calls).toEqual([{ name: 'Backlog' }]);
  });

  it('reverts on Escape without writing', async () => {
    const user = userEvent.setup();
    const calls = recordRenames();
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Rename list To Do' }));
    await user.type(screen.getByRole('textbox', { name: 'Rename list To Do' }), 'Backlog{Escape}');

    expect(calls).toEqual([]);
    expect(screen.getByRole('button', { name: 'Rename list To Do' })).toHaveTextContent('To Do');
  });

  it('opens the list menu from the three-dots button', async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'List actions' }));

    expect(await screen.findByText('Archive this list')).toBeInTheDocument();
  });

  it('keeps the menu button away from the drag sensor but not the title', async () => {
    const user = userEvent.setup();
    // `@hello-pangea/dnd` binds its mouse sensor to `window` (CLAUDE.md section 8).
    const sensor = vi.fn();
    window.addEventListener('mousedown', sensor);
    renderHeader();

    // The header is the list's drag handle and its `Draggable` has the library's
    // interactive-element blocking turned off, so the title must reach the sensor...
    await user.click(screen.getByRole('button', { name: 'Rename list To Do' }));
    expect(sensor).toHaveBeenCalledTimes(1);

    // ...while "List actions" must not: the sensor would `preventDefault` its mousedown, so
    // the button never takes focus for the popover to return, and a 5px wobble while clicking
    // it would lift the column instead of opening the menu.
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'List actions' }));
    expect(sensor).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Archive this list')).toBeInTheDocument();

    window.removeEventListener('mousedown', sensor);
  });
});
