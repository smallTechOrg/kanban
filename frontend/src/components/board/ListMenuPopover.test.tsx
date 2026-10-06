import { useState, type ReactElement } from 'react';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ToastViewport } from '@/components/ui';
import { useToast, useToasts } from '@/hooks/useToast';
import { useUiStore } from '@/store/uiStore';
import { makeListOut, metaFixture } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { ListMenuPopover } from './ListMenuPopover';

const BOARD_ID = 7;
/** "To Do" and "Doing" of the fixture board (`boardPayloadFixture`). */
const LIST_ID = 11;
const OTHER_LIST_ID = 12;

/** Every write the menu can make, as `METHOD path body` lines in the order they were sent. */
function recordCalls(): string[] {
  const calls: string[] = [];
  const record = async (method: string, path: string, request: Request): Promise<void> => {
    const body = request.body === null ? '' : ` ${JSON.stringify(await request.json())}`;
    calls.push(`${method} ${path}${body}`);
  };

  server.use(
    http.get('/api/meta', () =>
      HttpResponse.json({ ...metaFixture, list_colors: { green: 'rgb(186, 243, 219)' } }),
    ),
    http.patch('/api/lists/:listId', async ({ request, params }) => {
      await record('PATCH', `/lists/${String(params['listId'])}`, request);
      return HttpResponse.json({ item: makeListOut({ id: LIST_ID }), board_version: 2 });
    }),
    http.post('/api/lists/:listId/copy', async ({ request, params }) => {
      await record('POST', `/lists/${String(params['listId'])}/copy`, request);
      return HttpResponse.json(
        { item: makeListOut({ id: 21 }), board_version: 2 },
        { status: 201 },
      );
    }),
    http.post('/api/lists/:listId/move', async ({ request, params }) => {
      await record('POST', `/lists/${String(params['listId'])}/move`, request);
      return HttpResponse.json({
        item: makeListOut({ id: LIST_ID }),
        positions: {},
        board_version: 2,
      });
    }),
    http.post('/api/lists/:listId/sort', async ({ request, params }) => {
      await record('POST', `/lists/${String(params['listId'])}/sort`, request);
      return HttpResponse.json({ positions: {}, board_version: 2 });
    }),
    http.post('/api/lists/:listId/move-all-cards', async ({ request, params }) => {
      await record('POST', `/lists/${String(params['listId'])}/move-all-cards`, request);
      return HttpResponse.json({ moved: 2, positions: {}, board_version: 2 });
    }),
    http.post('/api/lists/:listId/archive-all-cards', async ({ request, params }) => {
      await record('POST', `/lists/${String(params['listId'])}/archive-all-cards`, request);
      return HttpResponse.json({ archived: 2, archived_ids: [101, 102], board_version: 2 });
    }),
    http.post('/api/lists/:listId/unarchive-cards', async ({ request, params }) => {
      await record('POST', `/lists/${String(params['listId'])}/unarchive-cards`, request);
      return HttpResponse.json({ restored: 2, board_version: 3 });
    }),
    http.post('/api/lists/:listId/archive', async ({ request, params }) => {
      await record('POST', `/lists/${String(params['listId'])}/archive`, request);
      return HttpResponse.json({
        item: makeListOut({ id: LIST_ID, is_archived: true }),
        board_version: 2,
      });
    }),
    http.post('/api/lists/:listId/unarchive', async ({ request, params }) => {
      await record('POST', `/lists/${String(params['listId'])}/unarchive`, request);
      return HttpResponse.json({ item: makeListOut({ id: LIST_ID }), board_version: 3 });
    }),
  );
  return calls;
}

/**
 * The trigger, the menu and the toast stack — what `ListHeader` mounts around it. The menu
 * closes itself the way the header does (`uiStore.openPopover` goes back to null), which
 * matters for the two undoable rows: the Undo link lives in `ToastViewport`, and while the
 * popover is open its focus manager marks everything outside it inert.
 */
function MenuHarness(): ReactElement {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(true);
  const toasts = useToasts();
  const { dismiss } = useToast();

  return (
    <>
      <button type="button" ref={setAnchor}>
        List actions
      </button>
      {open && anchor !== null ? (
        <ListMenuPopover
          boardId={BOARD_ID}
          listId={LIST_ID}
          anchor={anchor}
          onClose={() => setOpen(false)}
        />
      ) : null}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

/** Opens the menu and waits for the board payload its sub-views read. */
async function openMenu(): Promise<void> {
  renderWithProviders(<MenuHarness />, `/b/${BOARD_ID}`);
  await screen.findByText('Add card');
}

const row = (name: string): HTMLElement => screen.getByRole('button', { name });

describe('ListMenuPopover', () => {
  beforeEach(() => {
    useUiStore.setState({ composer: null, openPopover: null });
  });

  it('opens the card composer at the top of the list and closes', async () => {
    const user = userEvent.setup();
    await openMenu();

    await user.click(row('Add card'));

    expect(useUiStore.getState().composer).toEqual({
      kind: 'card',
      listId: LIST_ID,
      index: 'top',
    });
    expect(screen.queryByText('Archive this list')).not.toBeInTheDocument();
  });

  it('copies the list with the name the sub-view prefilled', async () => {
    const user = userEvent.setup();
    const calls = recordCalls();
    await openMenu();

    await user.click(row('Copy list…'));
    expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('To Do');
    await user.click(row('Create list'));

    expect(calls).toEqual([`POST /lists/${LIST_ID}/copy {"name":"To Do"}`]);
  });

  it('moves the list to the chosen slot on this board', async () => {
    const user = userEvent.setup();
    const calls = recordCalls();
    await openMenu();

    await user.click(row('Move list…'));
    // The select is 1-based; `index` is 0-based over the columns the server counts, and this
    // column is not one of them on its own board (Section 2.4.3).
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Position' }), '2');
    await user.click(row('Move'));

    expect(calls).toEqual([`POST /lists/${LIST_ID}/move {"index":1}`]);
  });

  it('hands the list to another board with to_board_id', async () => {
    const user = userEvent.setup();
    const calls = recordCalls();
    await openMenu();

    await user.click(row('Move list…'));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Space' }), 'Personal');
    await user.click(row('Move'));

    expect(calls).toEqual([`POST /lists/${LIST_ID}/move {"index":0,"to_board_id":3}`]);
  });

  it('marks the list its own current position and sends nothing when it is kept', async () => {
    const user = userEvent.setup();
    const calls = recordCalls();
    await openMenu();

    await user.click(row('Move list…'));
    expect(await screen.findByRole('option', { name: '1 (current)' })).toBeInTheDocument();
    await user.click(row('Move'));

    expect(calls).toEqual([]);
  });

  it('sorts the list by the chosen order', async () => {
    const user = userEvent.setup();
    const calls = recordCalls();
    await openMenu();

    await user.click(row('Sort by…'));
    await user.click(await screen.findByRole('button', { name: 'Card name (alphabetically)' }));

    expect(calls).toEqual([`POST /lists/${LIST_ID}/sort {"by":"title"}`]);
  });

  it('sets the list colour from the server palette', async () => {
    const user = userEvent.setup();
    const calls = recordCalls();
    await openMenu();

    await user.click(row('Change list color'));
    await user.click(await screen.findByRole('button', { name: 'green' }));

    expect(calls).toEqual([`PATCH /lists/${LIST_ID} {"color":"green"}`]);
  });

  it('removes the list colour', async () => {
    const user = userEvent.setup();
    const calls = recordCalls();
    await openMenu();

    await user.click(row('Change list color'));
    await user.click(await screen.findByRole('button', { name: 'Remove color' }));

    expect(calls).toEqual([`PATCH /lists/${LIST_ID} {"color":null}`]);
  });

  it('moves all cards to another list of the board', async () => {
    const user = userEvent.setup();
    const calls = recordCalls();
    await openMenu();

    await user.click(row('Move all cards in this list…'));
    await user.click(await screen.findByRole('button', { name: 'Doing' }));

    expect(calls).toEqual([
      `POST /lists/${LIST_ID}/move-all-cards {"to_list_id":${OTHER_LIST_ID}}`,
    ]);
  });

  it('archives every card behind a confirmation, then undoes it with the archived ids', async () => {
    const user = userEvent.setup();
    const calls = recordCalls();
    await openMenu();

    await user.click(row('Archive all cards in this list…'));
    expect(await screen.findByText(/This will remove all the cards/)).toBeInTheDocument();
    expect(calls).toEqual([]);

    await user.click(row('Archive all'));
    expect(await screen.findByText('2 cards archived')).toBeInTheDocument();

    await user.click(row('Undo'));

    expect(calls).toEqual([
      `POST /lists/${LIST_ID}/archive-all-cards`,
      `POST /lists/${LIST_ID}/unarchive-cards {"card_ids":[101,102]}`,
    ]);
  });

  it('archives the list with an Undo that sends it back', async () => {
    const user = userEvent.setup();
    const calls = recordCalls();
    await openMenu();

    await user.click(row('Archive this list'));
    expect(await screen.findByText('List archived')).toBeInTheDocument();

    await user.click(row('Undo'));

    expect(calls).toEqual([`POST /lists/${LIST_ID}/archive`, `POST /lists/${LIST_ID}/unarchive`]);
  });
});
