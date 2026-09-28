import { act, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '@/store/uiStore';
import { boardPayloadFixture } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { CardShortcutPopovers } from './CardShortcutPopovers';

const BOARD_ID = boardPayloadFixture.board.id;
const CARD_ID = 101;

function anchor(): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

describe('CardShortcutPopovers', () => {
  beforeEach(() => {
    useUiStore.getState().setOpenPopover(null);
  });

  it('renders nothing for a popover a control already owns', () => {
    renderWithProviders(<CardShortcutPopovers boardId={BOARD_ID} />);

    act(() => useUiStore.getState().setOpenPopover({ kind: 'labels', anchor: anchor() }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the panel the L key asked for, for the card it aimed at', async () => {
    renderWithProviders(<CardShortcutPopovers boardId={BOARD_ID} />);

    act(() =>
      useUiStore.getState().setOpenPopover({
        kind: 'labels',
        anchor: anchor(),
        props: { cardId: CARD_ID, shortcut: true },
      }),
    );

    expect(await screen.findByRole('dialog', { name: 'Labels' })).toBeInTheDocument();
  });
});
