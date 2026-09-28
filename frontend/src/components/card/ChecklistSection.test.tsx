import { useState, type ReactElement } from 'react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useCardDetail } from '@/hooks/useCard';
import { CHECKLIST_DRAG_TYPE, checklistsDropId } from '@/lib/cardDnd';
import { renderWithProviders } from '@/test/render';
import { ChecklistSection } from './ChecklistSection';

const BOARD_ID = 7;
const CARD_ID = 101;

/**
 * The section reads its checklist from the `['card', 101]` cache the way the modal feeds it, so
 * a tick goes through the real optimistic path instead of a prop the test sets by hand. It also
 * needs the two droppables it lives in, which `CardDetailModal` and `CardModalMain` provide.
 */
function Host(): ReactElement {
  const card = useCardDetail(CARD_ID).data;
  const [hideChecked, setHideChecked] = useState(false);
  if (card === undefined) return <p>Loading</p>;
  const checklist = card.checklists[0];
  if (checklist === undefined) throw new Error('fixture checklist missing');

  return (
    <DragDropContext onDragEnd={() => undefined}>
      <Droppable droppableId={checklistsDropId(CARD_ID)} type={CHECKLIST_DRAG_TYPE}>
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            <ChecklistSection
              boardId={BOARD_ID}
              cardId={CARD_ID}
              checklist={checklist}
              index={0}
              hideChecked={hideChecked}
              onToggleHideChecked={() => setHideChecked(!hideChecked)}
            />
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}

describe('ChecklistSection', () => {
  it('moves the progress bar when an item is ticked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);

    // The fixture is "Launch steps" with Wireframe ticked and Palette not: one of two.
    const bar = await screen.findByRole('progressbar', { name: 'Launch steps' });
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByText('50%')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Palette' }));

    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '2'));
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('hides the checked rows and says how many are hidden', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);

    await user.click(await screen.findByRole('button', { name: 'Hide checked items (1)' }));

    expect(screen.queryByRole('checkbox', { name: 'Wireframe' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Palette' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show checked items (1)' })).toBeInTheDocument();
  });

  it('asks whether a multi-line paste should become one item per line', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);

    await user.click(await screen.findByRole('button', { name: 'Add an item' }));
    const composer = screen.getByRole('textbox', { name: 'Add an item' });
    await user.click(composer);
    await user.paste('Buy domain\nWire DNS\n\nShip it');

    // Three non-empty lines, and the text is not in the composer until the question is answered.
    expect(await screen.findByText('Add 3 items?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add 3 items' })).toBeInTheDocument();
    expect(composer).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Add as one item' }));
    expect(composer).toHaveValue('Buy domain Wire DNS Ship it');
  });

  it('adds one item and keeps the composer open for the next', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);

    await user.click(await screen.findByRole('button', { name: 'Add an item' }));
    const composer = screen.getByRole('textbox', { name: 'Add an item' });
    await user.type(composer, 'Announce{Enter}');

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Announce' })).not.toBeChecked(),
    );
    expect(composer).toHaveValue('');
    expect(composer).toHaveFocus();
  });
});
