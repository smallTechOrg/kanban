import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DRAG_HANDLE_SELECTOR,
  board,
  global,
  isActivatableTarget,
  isDragHandleTarget,
  isEditableTarget,
  normalizeKey,
  shortcutFor,
  type KeyEventLike,
  type ShortcutScope,
} from './shortcuts';

function event(key: string, overrides: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    target: null,
    ...overrides,
  };
}

function press(
  key: string,
  overrides: Partial<KeyEventLike> = {},
  scope: ShortcutScope = 'board',
  isDragging = false,
): string | null {
  return shortcutFor(scope, event(key, overrides), { isDragging })?.action ?? null;
}

/** A detached element the guards can walk up from. */
function element(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  const child = host.firstElementChild;
  if (child === null) throw new Error('no element in the fixture');
  return child;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('normalizeKey', () => {
  it('upper-cases letters, names the space bar and leaves the rest alone', () => {
    expect(normalizeKey('f')).toBe('F');
    expect(normalizeKey('F')).toBe('F');
    expect(normalizeKey(' ')).toBe('Space');
    expect(normalizeKey('ArrowDown')).toBe('ArrowDown');
    expect(normalizeKey('/')).toBe('/');
  });
});

describe('the two tables', () => {
  it('keeps the drag-handle selector the installed library actually emits', () => {
    // vitest runs from the frontend package root, where the dependency is installed.
    const source = readFileSync(
      join(process.cwd(), 'node_modules/@hello-pangea/dnd/src/view/data-attributes.ts'),
      'utf8',
    );
    const prefix = /export const prefix = '([^']+)'/.exec(source)?.[1];
    expect(prefix).toBe('data-rfd');
    expect(DRAG_HANDLE_SELECTOR).toBe(`[${prefix}-drag-handle-draggable-id]`);
  });

  it('is the cheat sheet: the four global keys and the board rows, dispatched or not', () => {
    expect(global.map((row) => row.chips.join(' '))).toEqual(['/', 'B', '?', 'Esc']);
    expect(global.every((row) => row.action !== null)).toBe(true);
    // The editor and drag rows render as chips but dispatch nothing (Sections 2.8 and 5.9).
    const sheetOnly = board.filter((row) => row.action === null);
    expect(sheetOnly.map((row) => row.group)).toEqual([
      'Editors',
      'Editors',
      'Editors',
      'Drag with the keyboard',
    ]);
    expect(sheetOnly.every((row) => row.keys.length === 0)).toBe(true);
    expect(board.filter((row) => row.action !== null).every((row) => row.keys.length > 0)).toBe(
      true,
    );
  });
});

describe('shortcutFor', () => {
  it('dispatches each scope from its own table only', () => {
    expect(press('/', {}, 'global')).toBe('focusSearch');
    expect(press('b', {}, 'global')).toBe('openBoards');
    expect(press('?', {}, 'global')).toBe('openShortcuts');
    expect(press('Escape', {}, 'global')).toBe('closeTopmost');
    expect(press('f', {}, 'global')).toBeNull();
    expect(press('/', {}, 'board')).toBeNull();
  });

  it('dispatches the board and card keys', () => {
    expect(press('f')).toBe('openFilter');
    expect(press('x')).toBe('clearFilters');
    expect(press('w')).toBe('toggleBoardMenu');
    expect(press('Enter')).toBe('openCard');
    expect(press('e')).toBe('quickEdit');
    expect(press('t')).toBe('quickEditTitle');
    expect(press('n')).toBe('composeBelow');
    expect(press('l')).toBe('openLabels');
    expect(press('d')).toBe('openDates');
    expect(press('c')).toBe('archiveCard');
    expect(press(',')).toBe('moveToPreviousList');
    expect(press('<')).toBe('moveToPreviousList');
    expect(press('.')).toBe('moveToNextList');
    expect(press('>')).toBe('moveToNextList');
    expect(press('j')).toBe('selectNextCard');
    expect(press('ArrowDown')).toBe('selectNextCard');
    expect(press('k')).toBe('selectPreviousCard');
    expect(press('ArrowUp')).toBe('selectPreviousCard');
    expect(press('ArrowLeft')).toBe('selectListLeft');
    expect(press('ArrowRight')).toBe('selectListRight');
    expect(press('y')).toBeNull();
    // Space belongs to the drag library alone now that no row of either table claims it.
    expect(press(' ')).toBeNull();
  });

  it('carries the label number for 1-9', () => {
    expect(shortcutFor('board', event('3'), { isDragging: false })).toEqual({
      action: 'toggleLabelAtIndex',
      labelIndex: 3,
    });
    expect(press('0')).toBeNull();
  });

  it('leaves every modifier combination and an IME composition alone', () => {
    expect(press('Enter', { ctrlKey: true })).toBeNull();
    expect(press('Enter', { metaKey: true })).toBeNull();
    expect(press('c', { altKey: true })).toBeNull();
    expect(press('c', { isComposing: true })).toBeNull();
  });

  it('passes every key but Escape through while a field has focus', () => {
    for (const html of [
      '<input />',
      '<textarea></textarea>',
      '<select></select>',
      '<div contenteditable="true"><span>draft</span></div>',
    ]) {
      const target = element(html);
      const inner = target.firstElementChild ?? target;
      expect(press('c', { target: inner })).toBeNull();
      expect(press('Escape', { target: inner }, 'global')).toBe('closeTopmost');
    }
    expect(press('c', { target: element('<div contenteditable="false"></div>') })).toBe(
      'archiveCard',
    );
    expect(press('c', { target: element('<div></div>') })).toBe('archiveCard');
  });

  it('leaves Enter and the arrows to the drag library', () => {
    const handle = element('<a data-rfd-drag-handle-draggable-id="card-1"><b>Card</b></a>');
    const inside = handle.firstElementChild ?? handle;

    expect(press('Enter', { target: inside })).toBeNull();
    expect(press('ArrowDown', { target: inside })).toBeNull();
    // Everything else still works from a focused handle.
    expect(press('c', { target: inside })).toBe('archiveCard');

    expect(press('ArrowUp', {}, 'board', true)).toBeNull();
    expect(press('ArrowLeft', {}, 'board', true)).toBeNull();
    expect(press('c', {}, 'board', true)).toBe('archiveCard');
  });

  it('leaves Enter to a focused control that activates on it', () => {
    for (const html of [
      '<button><span>Labels</span></button>',
      '<a href="/b/1"><span>Card</span></a>',
      '<summary><span>More</span></summary>',
      '<div role="button"><span>Row</span></div>',
      '<div role="checkbox"><span>Done</span></div>',
      '<div role="menuitem"><span>Archive</span></div>',
      '<div role="tab"><span>Custom</span></div>',
    ]) {
      const target = element(html);
      const inner = target.firstElementChild ?? target;
      expect(press('Enter', { target: inner })).toBeNull();
      // Only that one key: the card shortcuts still fire from a focused button.
      expect(press('c', { target: inner })).toBe('archiveCard');
      expect(press('3', { target: inner })).toBe('toggleLabelAtIndex');
      // And the arrows keep moving the focus ring, which no button consumes.
      expect(press('ArrowDown', { target: inner })).toBe('selectNextCard');
    }

    // A plain container is not a control, so Enter still opens the current card.
    expect(press('Enter', { target: element('<div></div>') })).toBe('openCard');
    // An anchor without an href is not a link and activates on nothing.
    expect(press('Enter', { target: element('<a></a>') })).toBe('openCard');
  });
});

describe('the guards on their own', () => {
  it('reads an editable target', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(element('<input />'))).toBe(true);
    expect(isEditableTarget(element('<div></div>'))).toBe(false);
  });

  it('reads a drag handle', () => {
    expect(isDragHandleTarget(null)).toBe(false);
    expect(
      isDragHandleTarget(element('<div data-rfd-drag-handle-draggable-id="card-1"></div>')),
    ).toBe(true);
    expect(isDragHandleTarget(element('<div></div>'))).toBe(false);
  });

  it('reads a control that Enter or Space activates', () => {
    expect(isActivatableTarget(null)).toBe(false);
    expect(isActivatableTarget(element('<button></button>'))).toBe(true);
    expect(isActivatableTarget(element('<a href="/"></a>'))).toBe(true);
    expect(isActivatableTarget(element('<div role="switch"></div>'))).toBe(true);
    expect(isActivatableTarget(element('<div role="menuitemcheckbox"></div>'))).toBe(true);
    expect(isActivatableTarget(element('<div role="menuitemradio"></div>'))).toBe(true);
    expect(isActivatableTarget(element('<div role="radio"></div>'))).toBe(true);
    expect(isActivatableTarget(element('<div role="option"></div>'))).toBe(true);
    expect(isActivatableTarget(element('<div role="link"></div>'))).toBe(true);
    expect(isActivatableTarget(element('<div></div>'))).toBe(false);
  });
});
