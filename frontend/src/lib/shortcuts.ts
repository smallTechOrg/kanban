/**
 * The keyboard map of Sections 2.8 and 5.9: the two tables, and the guards that decide whether a
 * key may act at all. Pure, so the one thing that can be wrong here — a key stolen from a text
 * field or from the drag library — is covered by a unit test rather than by a browser run.
 *
 * `hooks/useKeyboardShortcuts.ts` mounts this twice (`'global'` in `AppShell`, `'board'` in
 * `BoardPage`) and maps each `ShortcutAction` onto the behaviour it owns; `KeyboardShortcutsModal`
 * renders the same two tables as the cheat sheet, so the sheet cannot drift from the handler. Rows
 * whose `action` is `null` are cheat-sheet-only: `Ctrl/Cmd+Enter`, `Shift+Enter` and `Tab` belong
 * to the focused editor, and the last group describes dragging with the keyboard, which is the DnD
 * library's own behaviour.
 */

/**
 * The attribute `@hello-pangea/dnd` puts on every drag handle (v16 renamed react-beautiful-dnd's
 * `data-rbd-*` to `data-rfd-*`). Section 5.9 keeps it in this one constant, and the sibling test
 * checks it against the installed package's own source.
 */
export const DRAG_HANDLE_SELECTOR = '[data-rfd-drag-handle-draggable-id]';

export type ShortcutScope = 'global' | 'board';

/** The cheat sheet's groups, in the order `KeyboardShortcutsModal` prints them. */
export type ShortcutGroup = 'Global' | 'Board' | 'Card' | 'Editors' | 'Drag with the keyboard';

/**
 * What a key asks the app to do. The handler owns every one of these; this module only names them,
 * which is what keeps the table free of React.
 */
export type ShortcutAction =
  | 'focusSearch'
  | 'openBoards'
  | 'openShortcuts'
  | 'closeTopmost'
  | 'openFilter'
  | 'clearFilters'
  | 'toggleBoardMenu'
  | 'openCard'
  | 'quickEdit'
  | 'quickEditTitle'
  | 'composeBelow'
  | 'openLabels'
  | 'openDates'
  | 'archiveCard'
  | 'toggleLabelAtIndex'
  | 'moveToPreviousList'
  | 'moveToNextList'
  | 'selectNextCard'
  | 'selectPreviousCard'
  | 'selectListLeft'
  | 'selectListRight';

export interface Shortcut {
  /** The normalised keys this row acts on; empty for a cheat-sheet-only row. */
  keys: readonly string[];
  /** What the `<Kbd>` chips read, which is not always the `event.key` value ("Space", "1-9"). */
  chips: readonly string[];
  action: ShortcutAction | null;
  group: ShortcutGroup;
  description: string;
}

/** The four Global-scope keys, live on every page including Home (Section 2.8). */
export const global: readonly Shortcut[] = [
  {
    keys: ['/'],
    chips: ['/'],
    action: 'focusSearch',
    group: 'Global',
    description: 'Focus the top-bar search',
  },
  {
    keys: ['B'],
    chips: ['B'],
    action: 'openBoards',
    group: 'Global',
    description: 'Open the boards popover (recent and starred)',
  },
  {
    keys: ['?'],
    chips: ['?'],
    action: 'openShortcuts',
    group: 'Global',
    description: 'Open this shortcuts sheet',
  },
  {
    keys: ['Escape'],
    chips: ['Esc'],
    action: 'closeTopmost',
    group: 'Global',
    description: 'Close the topmost popover, editor, quick edit, modal or drawer',
  },
];

/** Every Board- and Card-scope key, mounted by `BoardPage` and gone when it unmounts. */
export const board: readonly Shortcut[] = [
  {
    keys: ['F'],
    chips: ['F'],
    action: 'openFilter',
    group: 'Board',
    description: 'Open the Filter popover',
  },
  {
    keys: ['X'],
    chips: ['X'],
    action: 'clearFilters',
    group: 'Board',
    description: 'Clear all filters',
  },
  {
    keys: ['W'],
    chips: ['W'],
    action: 'toggleBoardMenu',
    group: 'Board',
    description: 'Toggle the board menu drawer',
  },
  {
    keys: ['J', 'ArrowDown'],
    chips: ['J', 'Down'],
    action: 'selectNextCard',
    group: 'Board',
    description: 'Select the next card in the same list',
  },
  {
    keys: ['K', 'ArrowUp'],
    chips: ['K', 'Up'],
    action: 'selectPreviousCard',
    group: 'Board',
    description: 'Select the previous card in the same list',
  },
  {
    keys: ['ArrowLeft'],
    chips: ['Left'],
    action: 'selectListLeft',
    group: 'Board',
    description: 'Select the card at the same index in the list to the left',
  },
  {
    keys: ['ArrowRight'],
    chips: ['Right'],
    action: 'selectListRight',
    group: 'Board',
    description: 'Select the card at the same index in the list to the right',
  },
  {
    keys: ['Enter'],
    chips: ['Enter'],
    action: 'openCard',
    group: 'Card',
    description: 'Open the current card',
  },
  {
    keys: ['E'],
    chips: ['E'],
    action: 'quickEdit',
    group: 'Card',
    description: 'Quick edit the current card',
  },
  {
    keys: ['T'],
    chips: ['T'],
    action: 'quickEditTitle',
    group: 'Card',
    description: 'Quick edit with the title selected',
  },
  {
    keys: ['N'],
    chips: ['N'],
    action: 'composeBelow',
    group: 'Card',
    description: 'Add a card below the current one',
  },
  {
    keys: ['L'],
    chips: ['L'],
    action: 'openLabels',
    group: 'Card',
    description: 'Open the Labels popover',
  },
  {
    keys: ['D'],
    chips: ['D'],
    action: 'openDates',
    group: 'Card',
    description: 'Open the Dates popover',
  },
  {
    keys: ['C'],
    chips: ['C'],
    action: 'archiveCard',
    group: 'Card',
    description: 'Archive the card (with an Undo toast)',
  },
  {
    keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    chips: ['1-9'],
    action: 'toggleLabelAtIndex',
    group: 'Card',
    description: 'Toggle the nth label of the board',
  },
  {
    keys: [',', '<'],
    chips: [',', '<'],
    action: 'moveToPreviousList',
    group: 'Card',
    description: 'Move the card to the top of the previous list',
  },
  {
    keys: ['.', '>'],
    chips: ['.', '>'],
    action: 'moveToNextList',
    group: 'Card',
    description: 'Move the card to the top of the next list',
  },
  {
    keys: [],
    chips: ['Ctrl', 'Enter'],
    action: null,
    group: 'Editors',
    description: 'Submit the focused description, card or list composer',
  },
  {
    keys: [],
    chips: ['Shift', 'Enter'],
    action: null,
    group: 'Editors',
    description: 'Insert a newline in a card composer',
  },
  {
    keys: [],
    chips: ['Tab'],
    action: null,
    group: 'Editors',
    description: 'Move focus from a card composer to its "Add card" button',
  },
  {
    keys: [],
    chips: ['Tab', 'Space', 'Arrows', 'Esc'],
    action: null,
    group: 'Drag with the keyboard',
    description:
      'Focus a card with Tab, then Space to lift, arrows to move, Space to drop, Esc to cancel. ' +
      'While a card is focused or lifted, Space and the arrows belong to dragging and Enter ' +
      'opens the card.',
  },
];

/**
 * The keys of the tables above that the DnD library owns while a drag is live or a handle has
 * focus (Section 2.8). Space is the library's alone — no row of either table claims it — so it
 * needs no entry: nothing here would ever `preventDefault` it away from the sensor.
 */
const DRAG_KEYS: readonly string[] = ['Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/** The dispatch table of Section 5.9: one normalised key to one action, per scope. */
function buildDispatch(rows: readonly Shortcut[]): Map<string, ShortcutAction> {
  const dispatch = new Map<string, ShortcutAction>();
  for (const row of rows) {
    if (row.action === null) continue;
    for (const key of row.keys) dispatch.set(key, row.action);
  }
  return dispatch;
}

const DISPATCH: Record<ShortcutScope, Map<string, ShortcutAction>> = {
  global: buildDispatch(global),
  board: buildDispatch(board),
};

/** As much of a `KeyboardEvent` as the guards and the table read. */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  target: EventTarget | null;
}

export interface ShortcutState {
  /** `uiStore.isDragging`: while a lift is live the library owns Space, Enter and the arrows. */
  isDragging: boolean;
}

export interface ShortcutMatch {
  action: ShortcutAction;
  /** 1-9 for `toggleLabelAtIndex`, the nth label by `position`; absent for every other action. */
  labelIndex?: number;
}

/**
 * `event.key` as the tables spell it: a letter is upper-cased so Shift does not change the
 * meaning, and the space bar is "Space" rather than a character nobody can read in a table.
 */
export function normalizeKey(key: string): string {
  if (key === ' ') return 'Space';
  return key.length === 1 ? key.toUpperCase() : key;
}

/** Whether the event came from somewhere the reader is typing, where only Escape may act. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

/** Whether the event came from a drag handle, which owns Space, Enter and the arrows. */
export function isDragHandleTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(DRAG_HANDLE_SELECTOR) !== null;
}

/** `Enter` is the one key these tables claim that a focused control activates on by itself. */
const ACTIVATION_KEYS: readonly string[] = ['Enter'];

/**
 * Everything the browser (or an ARIA widget) activates when Enter or Space is pressed on it
 * while it has focus. `input`, `textarea` and `select` are absent because `isEditableTarget`
 * already answers for them.
 */
const ACTIVATABLE_SELECTOR = [
  'button',
  'summary',
  'a[href]',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="radio"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
].join(', ');

/**
 * Whether the event came from a control that Enter or Space activates on its own.
 *
 * Section 2.8's guards name text fields and drag handles, but the same rule has to hold for a
 * focused button: a keystroke this handler claims is `preventDefault`ed, and `preventDefault`
 * on an `Enter` keydown cancels the button's native activation. With a card open — which makes
 * `openCardId` the "current card" of Section 2.8 — that silently disabled Enter on every button
 * in the modal, so a keyboard-only reader could not reach the Labels popover at all while a
 * mouse user could (Section 5.10, "every interactive element is reachable by keyboard"). Only
 * that one key is affected; a focused button ignores `L`, `C` or `1`, so the card shortcuts
 * still fire while the focus sits on one.
 */
export function isActivatableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(ACTIVATABLE_SELECTOR) !== null;
}

/**
 * The action one keystroke asks for in one scope, or `null` when the key belongs to somebody
 * else: a modifier combination (`Ctrl/Cmd+Enter` is the focused editor's, and Trello's copy-paste
 * shortcuts are deliberately not implemented), an IME composition, a field being typed in
 * (Escape excepted), Enter or an arrow while a drag is live or a handle has focus, or Enter on a
 * control that activates on it itself (`isActivatableTarget`).
 */
export function shortcutFor(
  scope: ShortcutScope,
  event: KeyEventLike,
  state: ShortcutState,
): ShortcutMatch | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return null;
  const key = normalizeKey(event.key);
  if (key !== 'Escape' && isEditableTarget(event.target)) return null;
  if (DRAG_KEYS.includes(key) && (state.isDragging || isDragHandleTarget(event.target))) {
    return null;
  }
  if (ACTIVATION_KEYS.includes(key) && isActivatableTarget(event.target)) return null;
  const action = DISPATCH[scope].get(key);
  if (action === undefined) return null;
  return action === 'toggleLabelAtIndex' ? { action, labelIndex: Number(key) } : { action };
}
