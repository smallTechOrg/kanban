/**
 * The keyboard map, mounted twice (Sections 2.8 and 5.9): `useKeyboardShortcuts('global')` in
 * `AppShell` for `/ B ? Esc`, and `useKeyboardShortcuts('board', boardId)` in `BoardPage` for
 * every Board- and Card-scope key.
 *
 * What a keystroke *means* is `lib/shortcuts.ts` (the two tables, the editable-target guard, the
 * modifier rule and the drag-and-drop precedence of Section 2.8) and where the selection *goes*
 * is `lib/cardNav.ts`. This hook is only the wiring between them and the app: it resolves the
 * current card, calls one store action, one mutation or one navigation per key, and nothing else.
 * No filter rule, no position arithmetic and no second copy of a panel's behaviour lives here.
 *
 * Three details are worth knowing:
 *
 * - **The listener is on `window` in the capture phase**, so it reads the store before anything
 *   else has changed it. `Escape` matters here: `Popover`, `Modal` and `QuickCardEditor` each
 *   close themselves on Escape, and a bubbling handler would run *after* one of them had already
 *   cleared its store field and would then close the next thing in the chain as well.
 * - **The board is read from the query cache at keystroke time**, not subscribed to, so hovering
 *   or typing on a 3,000-card board does not re-render the page (Section 5.11). The one exception
 *   is the target card id, which the three card-bound mutations below have to be built with.
 * - **Nothing is dispatched by a component.** Which panel a key opens is `uiStore.openPopover`,
 *   the one field that keeps a single popover open across the app, so the owner of that panel
 *   renders it exactly as it would after a click: the modal's sidebar when the card is open, and
 *   `board/CardShortcutPopovers.tsx` when the target is a tile.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { neighboursAt } from '@/lib/boardDnd';
import { selectLabels, type BoardState, type CardRow, type Id } from '@/lib/boardState';
import {
  cardInList,
  cardInNeighbourList,
  firstCard,
  neighbourListId,
  slotBelowCard,
} from '@/lib/cardNav';
import {
  shortcutFor,
  type ShortcutAction,
  type ShortcutMatch,
  type ShortcutScope,
} from '@/lib/shortcuts';
import { useUiStore, type PopoverKind } from '@/store/uiStore';
import { boardKey } from './useBoardData';
import { useArchiveCard, useMoveCard, useUnarchiveCard } from './useBoardMutations';
import { useToggleCardLabel } from './useCardMutations';
import { useToast } from './useToast';

/**
 * The attribute that says "this element is what shortcut `<name>` aims at": the search input
 * (`search`), the boards button (`boards`), the board header's Filter control (`filter`), the
 * two card-modal sidebar rows a key can open (`labels`, `dates`) and every card tile
 * (`card-<id>`). A keystroke has no `event.currentTarget` to anchor a popover to, and the plan
 * anchors each panel to the control that owns it (Sections 2.3.1, 2.6.4 and 5.9), so the one
 * lookup lives here rather than as a ref handed down through four component layers.
 */
export const SHORTCUT_ANCHOR_ATTR = 'data-shortcut-anchor';

/** The `data-shortcut-anchor` value of one card's tile. */
export function cardAnchorName(cardId: Id): string {
  return `card-${String(cardId)}`;
}

/** The scope's board, or 0 in the `'global'` mount, which has no board and no board key. */
const NO_BOARD = 0;

/** "No current card": the id the card-bound mutations are built with while nothing is targeted. */
const NO_CARD = 0;

function anchorFor(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${SHORTCUT_ANCHOR_ATTR}="${name}"]`);
}

/** The four keys that only move the focus ring; they need no card and write no server state. */
const SELECTIONS: readonly ShortcutAction[] = [
  'selectNextCard',
  'selectPreviousCard',
  'selectListLeft',
  'selectListRight',
];

/** Every key this hook acts on for a card; the rest need no target (Section 2.8). */
const CARD_ACTIONS: readonly ShortcutAction[] = [
  'openCard',
  'quickEdit',
  'quickEditTitle',
  'composeBelow',
  'openLabels',
  'openDates',
  'archiveCard',
  'toggleLabelAtIndex',
  'moveToPreviousList',
  'moveToNextList',
];

/** The two panels a card key opens, by the action that opens them. */
const CARD_PANELS: Partial<Record<ShortcutAction, PopoverKind>> = {
  openLabels: 'labels',
  openDates: 'dates',
};

/**
 * Mount the keyboard map for one scope. `boardId` is required by the `'board'` scope and unused
 * by `'global'`, whose four keys work on every page (Section 2.8).
 */
export function useKeyboardShortcuts(scope: ShortcutScope, boardId: number = NO_BOARD): void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { show } = useToast();

  // The only subscription: the card the next keystroke acts on, which the three card-bound
  // mutations have to be created with. `0` is "no card", and their `mutate` is then never called.
  const targetCardId = useUiStore(
    (state) => state.openCardId ?? state.focusedCardId ?? state.hoveredCardId ?? NO_CARD,
  );

  const archiveCard = useArchiveCard(boardId);
  const unarchiveCard = useUnarchiveCard(boardId);
  const moveCard = useMoveCard(boardId);
  const toggleLabel = useToggleCardLabel(boardId, targetCardId);

  const boardState = useCallback(
    (): BoardState | undefined => queryClient.getQueryData<BoardState>(boardKey(boardId)),
    [queryClient, boardId],
  );

  const run = useCallback(
    (match: ShortcutMatch): boolean => {
      const ui = useUiStore.getState();
      const { action } = match;

      switch (action) {
        case 'focusSearch': {
          const input = anchorFor('search');
          if (!(input instanceof HTMLInputElement)) return false;
          input.focus();
          input.select();
          return true;
        }
        case 'openBoards': {
          const anchor = anchorFor('boards');
          if (anchor === null) return false;
          // Section 2.8: the key opens "Recent + Starred", not one of the two nav dropdowns.
          ui.setOpenPopover({ kind: 'boards', anchor, props: { group: 'both' } });
          return true;
        }
        case 'openShortcuts':
          ui.setShortcutsOpen(true);
          return true;
        case 'closeTopmost':
          // The chain of Sections 2.8 and 5.9. Its first four links own Escape themselves — a
          // popover, an open editor or composer, the quick editor and the modal all close on the
          // key without help — so the only thing left for this handler is the drawer behind them.
          if (ui.openPopover !== null) return false;
          if (ui.composer !== null) return false;
          if (ui.quickEditCardId !== null) return false;
          if (ui.openCardId !== null) return false;
          if (!ui.boardMenuOpen) return false;
          ui.setBoardMenuOpen(false);
          return true;
        case 'openFilter': {
          const anchor = anchorFor('filter');
          if (anchor === null) return false;
          ui.setOpenPopover({ kind: 'filter', anchor });
          return true;
        }
        case 'clearFilters':
          ui.resetFilter();
          return true;
        case 'toggleBoardMenu':
          ui.setBoardMenuOpen(!ui.boardMenuOpen);
          return true;
        default:
          break;
      }

      if (!CARD_ACTIONS.includes(action)) return false;
      const state = boardState();
      if (state === undefined || targetCardId === NO_CARD) return false;
      const card: CardRow | undefined = state.cards[targetCardId];
      if (card === undefined) return false;

      switch (action) {
        case 'openCard':
          void navigate(`/b/${String(boardId)}/c/${String(card.id)}`);
          return true;
        case 'quickEdit':
        case 'quickEditTitle':
          // The overlay clones a tile, so it has nothing to open over an already-open card.
          if (ui.openCardId !== null) return false;
          ui.setQuickEditCardId(card.id, action === 'quickEditTitle');
          return true;
        case 'composeBelow': {
          const slot = slotBelowCard(state, card.id);
          if (slot === null) return false;
          ui.setComposer({ kind: 'card', listId: slot.listId, index: slot.index });
          return true;
        }
        case 'openLabels':
        case 'openDates': {
          const kind = CARD_PANELS[action];
          if (kind === undefined) return false;
          // The modal's sidebar row when the card is open, else the tile itself; whichever is
          // found is the element that owns the panel, and it renders it (Sections 2.5.4, 2.6.4).
          const sidebar = ui.openCardId === null ? null : anchorFor(kind);
          const anchor = sidebar ?? anchorFor(cardAnchorName(card.id));
          if (anchor === null) return false;
          ui.setOpenPopover({
            kind,
            anchor,
            props: sidebar === null ? { cardId: card.id, shortcut: true } : undefined,
          });
          return true;
        }
        case 'archiveCard':
          archiveCard.mutate(card.id);
          show('Card archived', 'neutral', {
            label: 'Undo',
            onClick: () => unarchiveCard.mutate(card.id),
          });
          return true;
        case 'toggleLabelAtIndex': {
          const label = selectLabels(state)[(match.labelIndex ?? 1) - 1];
          if (label === undefined) return false;
          toggleLabel.mutate({
            labelId: label.id,
            attached: !card.label_ids.includes(label.id),
          });
          return true;
        }
        case 'moveToPreviousList':
        case 'moveToNextList': {
          const direction = action === 'moveToNextList' ? 1 : -1;
          const toListId = neighbourListId(state, card.id, direction);
          if (toListId === null) return false;
          const order = state.cardOrder[toListId] ?? [];
          const { prevId, nextId } = neighboursAt(order, card.id, 0);
          moveCard.mutate({ cardId: card.id, toListId, index: 0, prevId, nextId });
          return true;
        }
        default:
          return false;
      }
    },
    [
      archiveCard,
      boardId,
      boardState,
      moveCard,
      navigate,
      show,
      targetCardId,
      toggleLabel,
      unarchiveCard,
    ],
  );

  const select = useCallback(
    (action: ShortcutAction): boolean => {
      const ui = useUiStore.getState();
      const state = boardState();
      if (state === undefined) return false;
      const current = ui.openCardId ?? ui.focusedCardId ?? ui.hoveredCardId;
      if (current === null) {
        const first = firstCard(state);
        if (first === null) return false;
        ui.setFocusedCardId(first);
        return true;
      }
      const next =
        action === 'selectNextCard'
          ? cardInList(state, current, 1)
          : action === 'selectPreviousCard'
            ? cardInList(state, current, -1)
            : cardInNeighbourList(state, current, action === 'selectListRight' ? 1 : -1);
      if (next === null) return false;
      ui.setFocusedCardId(next);
      return true;
    },
    [boardState],
  );

  const dispatch = useCallback(
    (event: KeyboardEvent): void => {
      const match = shortcutFor(scope, event, { isDragging: useUiStore.getState().isDragging });
      if (match === null) return;
      const handled = SELECTIONS.includes(match.action) ? select(match.action) : run(match);
      // Only a key this mount acted on is taken from the page: `/` would open the browser's
      // quick find and Space would scroll the canvas (Section 2.8).
      if (handled) event.preventDefault();
    },
    [scope, run, select],
  );

  const latest = useRef(dispatch);
  useEffect(() => {
    latest.current = dispatch;
  });

  useEffect(() => {
    // A board scope without a board listens to nothing: that is how `BoardPage` leaves the map
    // unmounted on a closed board, where every one of these keys would write to it (2.3.5).
    if (scope === 'board' && boardId === NO_BOARD) return undefined;
    function onKeyDown(event: KeyboardEvent): void {
      latest.current(event);
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [scope, boardId]);
}
