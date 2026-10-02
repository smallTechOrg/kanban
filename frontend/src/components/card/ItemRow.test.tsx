import type { ReactElement } from 'react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { UpdateItemInput } from '@/api/items';
import { useCardDetail } from '@/hooks/useCard';
import { ITEM_DRAG_TYPE, itemsDropId } from '@/lib/cardDnd';
import { formatDate } from '@/lib/dates';
import { makeCardDetail, makeCardItem } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { ItemRow } from './ItemRow';

const BOARD_ID = 7;
const CARD_ID = 101;
const ITEM_ID = 502;

/** A due date stored as the ISO-8601 UTC instant the API keeps (Section 4.1). */
const DUE_AT = '2026-10-01T15:00:00.000Z';

/**
 * Serves one card holding one item, and collects every item `PATCH` body. The row reads that
 * item out of the `['card', 101]` cache the way `ItemsSection` feeds it, so every click travels
 * the real optimistic path.
 */
function mount(item: ReturnType<typeof makeCardItem>): UpdateItemInput[] {
  const patches: UpdateItemInput[] = [];
  const detail = makeCardDetail({ id: CARD_ID, items: [item] });
  server.use(
    http.get('/api/cards/:cardId', () => HttpResponse.json(detail)),
    http.patch('/api/card-items/:itemId', async ({ request }) => {
      const patch = (await request.json()) as UpdateItemInput;
      patches.push(patch);
      return HttpResponse.json({
        item: {
          ...item,
          ...patch,
          badges: { description: false, item_done: 0, item_total: 1 },
        },
        board_version: 2,
      });
    }),
  );
  renderWithProviders(<Host />);
  return patches;
}

function Host(): ReactElement {
  const card = useCardDetail(CARD_ID).data;
  const item = card?.items[0];
  if (item === undefined) return <p>Loading</p>;

  return (
    <DragDropContext onDragEnd={() => undefined}>
      <Droppable droppableId={itemsDropId(CARD_ID)} type={ITEM_DRAG_TYPE}>
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            <ItemRow boardId={BOARD_ID} cardId={CARD_ID} item={item} index={0} />
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}

const PLAIN = makeCardItem({
  id: ITEM_ID,
  name: 'Palette',
  is_checked: false,
  checked_at: null,
});

describe('ItemRow', () => {
  it('saves the due date the popover was seeded with and shows the badge', async () => {
    const user = userEvent.setup();
    const patches = mount({ ...PLAIN, due_at: DUE_AT });

    // Section 2.6.3: a due item shows its date after the text before anything is clicked.
    expect(await screen.findByText(formatDate(DUE_AT))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Set due date for Palette' }));
    await user.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ due_at: DUE_AT });
  });

  it('clears the due date with Remove', async () => {
    const user = userEvent.setup();
    const patches = mount({ ...PLAIN, due_at: DUE_AT });

    await user.click(await screen.findByRole('button', { name: 'Set due date for Palette' }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ due_at: null });
    await waitFor(() => expect(screen.queryByText(formatDate(DUE_AT))).not.toBeInTheDocument());
  });

  it('renames the item from the inline editor', async () => {
    const user = userEvent.setup();
    const patches = mount(PLAIN);

    await user.click(await screen.findByRole('button', { name: 'Palette' }));
    const editor = screen.getByRole('textbox', { name: 'Item name' });
    await user.clear(editor);
    await user.type(editor, 'Colour palette{Enter}');

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ name: 'Colour palette' });
  });

  it('offers Delete and nothing else in its actions menu', async () => {
    const user = userEvent.setup();
    mount(PLAIN);

    await user.click(await screen.findByRole('button', { name: 'Item actions for Palette' }));

    expect(await screen.findByRole('button', { name: 'Delete' })).toBeInTheDocument();
    // "Convert to card" went with the checklist container it belonged to.
    expect(screen.queryByRole('button', { name: 'Convert to card' })).not.toBeInTheDocument();
  });
});
