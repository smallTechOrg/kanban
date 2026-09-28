import type { ReactElement } from 'react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { UpdateItemInput } from '@/api/checklists';
import { useCardDetail } from '@/hooks/useCard';
import { CHECKLIST_ITEM_DRAG_TYPE, checklistDropId } from '@/lib/cardDnd';
import { formatDate } from '@/lib/dates';
import { makeCardDetail, makeChecklistItem, memberFixture } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { ChecklistItemRow } from './ChecklistItemRow';

const BOARD_ID = 7;
const CARD_ID = 101;
const CHECKLIST_ID = 51;
const ITEM_ID = 502;

/** A due date stored as the ISO-8601 UTC instant the API keeps (Section 4.1). */
const DUE_AT = '2026-10-01T15:00:00.000Z';

/**
 * Serves one card whose single checklist holds one item, and collects every item `PATCH` body.
 * The row reads that item out of the `['card', 101]` cache the way `ChecklistSection` feeds it,
 * so every click travels the real optimistic path.
 */
function mount(item: ReturnType<typeof makeChecklistItem>): UpdateItemInput[] {
  const patches: UpdateItemInput[] = [];
  const detail = makeCardDetail({
    id: CARD_ID,
    checklists: [
      { id: CHECKLIST_ID, card_id: CARD_ID, name: 'Launch steps', position: 65536, items: [item] },
    ],
  });
  server.use(
    http.get('/api/cards/:cardId', () => HttpResponse.json(detail)),
    http.patch('/api/checklist-items/:itemId', async ({ request }) => {
      const patch = (await request.json()) as UpdateItemInput;
      patches.push(patch);
      return HttpResponse.json({
        item: {
          ...item,
          ...patch,
          badges: {
            description: false,
            comments: 0,
            attachments: 0,
            checklist_done: 0,
            checklist_total: 1,
          },
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
  const item = card?.checklists[0]?.items[0];
  if (item === undefined) return <p>Loading</p>;

  return (
    <DragDropContext onDragEnd={() => undefined}>
      <Droppable droppableId={checklistDropId(CHECKLIST_ID)} type={CHECKLIST_ITEM_DRAG_TYPE}>
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            <ChecklistItemRow boardId={BOARD_ID} cardId={CARD_ID} item={item} index={0} />
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}

const PLAIN = makeChecklistItem({
  id: ITEM_ID,
  name: 'Palette',
  is_checked: false,
  checked_at: null,
});

describe('ChecklistItemRow', () => {
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

  it('assigns a board member and shows their avatar on the row', async () => {
    const user = userEvent.setup();
    const patches = mount(PLAIN);

    await user.click(await screen.findByRole('button', { name: 'Assign Palette' }));
    await user.click(await screen.findByRole('button', { name: memberFixture.full_name }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ assignee_id: memberFixture.id });
    expect(await screen.findByRole('img', { name: memberFixture.full_name })).toBeInTheDocument();
  });

  it('unassigns the member who is already on the item', async () => {
    const user = userEvent.setup();
    const patches = mount({ ...PLAIN, assignee_id: memberFixture.id });

    await user.click(await screen.findByRole('button', { name: 'Assign Palette' }));
    const row = await screen.findByRole('button', { name: memberFixture.full_name, pressed: true });
    await user.click(row);

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ assignee_id: null });
  });
});
