import type { ReactElement } from 'react';
import { DatesPopover } from '@/components/card/DatesPopover';
import { LabelsPopover } from '@/components/card/LabelsPopover';
import { MembersPopover } from '@/components/card/MembersPopover';
import { useUiStore } from '@/store/uiStore';

export interface CardShortcutPopoversProps {
  boardId: number;
}

/**
 * The three panels the `L`, `M` and `D` keys open for a card *tile* (Sections 2.8 and 5.9).
 *
 * Every other opener of these panels is a control that renders them itself and anchors them to
 * itself — the modal's sidebar, the quick editor's action stack, the quick-badges row — and the
 * keyboard has no such control: it aims at whatever tile is hovered or selected. A key therefore
 * puts the tile in `uiStore.openPopover` with `props.shortcut`, and this one host renders the
 * panel for it, so `CardTile` stays the memoised leaf of Section 5.11 and nothing else in the
 * board has to know that a key can open a panel. With the card modal open the sidebar row *is*
 * available, so the key anchors to it and the sidebar renders it as it does after a click; that
 * popover carries no `shortcut` flag and this host ignores it.
 */
export function CardShortcutPopovers({ boardId }: CardShortcutPopoversProps): ReactElement | null {
  const popover = useUiStore((state) => state.openPopover);
  const setOpenPopover = useUiStore((state) => state.setOpenPopover);

  if (popover === null || popover.props?.['shortcut'] !== true) return null;
  const cardId = popover.props['cardId'];
  if (typeof cardId !== 'number') return null;

  const shared = { boardId, cardId, anchor: popover.anchor, onClose: () => setOpenPopover(null) };

  switch (popover.kind) {
    case 'labels':
      return <LabelsPopover {...shared} />;
    case 'members':
      return <MembersPopover {...shared} />;
    case 'dates':
      return <DatesPopover {...shared} />;
    default:
      return null;
  }
}
