import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeBoard } from '@/lib/normalize';
import { EMPTY_FILTER, useUiStore } from '@/store/uiStore';
import { boardPayloadFixture } from '@/test/handlers';
import { server } from '@/test/server';
import { boardKey } from './useBoardData';
import { SHORTCUT_ANCHOR_ATTR, useKeyboardShortcuts } from './useKeyboardShortcuts';

const BOARD_ID = boardPayloadFixture.board.id;

/** `[101, 102]` in list 11 and `[103]` in list 12, as the fixture board is shaped. */
const FIRST = 101;
const SECOND = 102;
const OTHER_LIST_CARD = 103;
const TODO_LIST = 11;

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/b/${String(BOARD_ID)}`]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

/** Mounts one scope over a board cache that already holds the fixture document. */
function mount(scope: 'global' | 'board' = 'board'): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  queryClient.setQueryData(boardKey(BOARD_ID), normalizeBoard(boardPayloadFixture));
  renderHook(
    () => {
      useKeyboardShortcuts(scope, scope === 'board' ? BOARD_ID : undefined);
    },
    { wrapper: wrapper(queryClient) },
  );
}

function press(key: string, init: KeyboardEventInit = {}, target?: HTMLElement): void {
  act(() => {
    (target ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  });
}

/** Store writes a test makes are flushed, so the mount sees them before the next keystroke. */
function set(change: () => void): void {
  act(change);
}

/** An element the hook can find by name, standing in for the real control. */
function anchor(name: string, tag: 'div' | 'input' = 'div'): HTMLElement {
  const element = document.createElement(tag);
  element.setAttribute(SHORTCUT_ANCHOR_ATTR, name);
  document.body.append(element);
  return element;
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    useUiStore.setState({
      openPopover: null,
      hoveredCardId: null,
      focusedCardId: null,
      openCardId: null,
      composer: null,
      quickEditCardId: null,
      filter: EMPTY_FILTER,
      boardMenuOpen: false,
      shortcutsOpen: false,
      isDragging: false,
    });
  });

  it('focuses the search field on "/" and opens the cheat sheet on "?"', () => {
    const input = anchor('search', 'input');
    mount('global');

    press('/');
    expect(document.activeElement).toBe(input);

    press('?');
    expect(useUiStore.getState().shortcutsOpen).toBe(true);
  });

  it('opens the boards popover on "B"', () => {
    const button = anchor('boards');
    mount('global');

    press('B');

    expect(useUiStore.getState().openPopover).toMatchObject({ kind: 'boards', anchor: button });
  });

  it('leaves every board key to the board scope', () => {
    mount('global');

    press('W');
    press('X');

    expect(useUiStore.getState().boardMenuOpen).toBe(false);
  });

  it('drives the filter with F and X and the drawer with W', () => {
    anchor('filter');
    mount();

    press('F');
    expect(useUiStore.getState().openPopover?.kind).toBe('filter');

    set(() => useUiStore.getState().setOpenPopover(null));
    set(() => useUiStore.getState().setFilter({ q: 'launch' }));

    press('X');
    expect(useUiStore.getState().filter).toEqual(EMPTY_FILTER);

    press('W');
    expect(useUiStore.getState().boardMenuOpen).toBe(true);
    press('W');
    expect(useUiStore.getState().boardMenuOpen).toBe(false);
  });

  it('ignores a key typed in a field, a Ctrl combination and an IME composition', () => {
    const field = document.createElement('input');
    document.body.append(field);
    mount();

    press('W', {}, field);
    press('W', { ctrlKey: true });
    press('W', { isComposing: true } as KeyboardEventInit);

    expect(useUiStore.getState().boardMenuOpen).toBe(false);
  });

  it('closes only the drawer with Escape, and only when nothing sits above it', () => {
    // Escape is a Global-scope key (Section 2.8), so it is the shell's mount that owns the chain.
    mount('global');
    set(() => useUiStore.getState().setBoardMenuOpen(true));
    set(() => useUiStore.getState().setQuickEditCardId(FIRST));

    press('Escape');
    expect(useUiStore.getState().boardMenuOpen).toBe(true);

    set(() => useUiStore.getState().setQuickEditCardId(null));
    press('Escape');
    expect(useUiStore.getState().boardMenuOpen).toBe(false);
  });

  it('moves the selection with J, K and the arrows', () => {
    mount();

    press('J');
    expect(useUiStore.getState().focusedCardId).toBe(FIRST);

    press('J');
    expect(useUiStore.getState().focusedCardId).toBe(SECOND);

    press('ArrowRight');
    expect(useUiStore.getState().focusedCardId).toBe(OTHER_LIST_CARD);

    // List 11 has two cards and list 12 one, so coming back clamps to that list's only slot.
    press('ArrowLeft');
    expect(useUiStore.getState().focusedCardId).toBe(FIRST);

    press('J');
    press('K');
    expect(useUiStore.getState().focusedCardId).toBe(FIRST);

    // Nothing above the first card, so the ring stays where it is.
    press('K');
    expect(useUiStore.getState().focusedCardId).toBe(FIRST);
  });

  it('leaves Space, Enter and the arrows to the drag library while a lift is live', () => {
    mount();
    set(() => useUiStore.setState({ isDragging: true, hoveredCardId: FIRST }));

    press('ArrowDown');
    press('Space');

    expect(useUiStore.getState().focusedCardId).toBeNull();
  });

  it('opens a composer below the current card with N', () => {
    mount();
    set(() => useUiStore.getState().setHoveredCardId(FIRST));

    press('N');

    expect(useUiStore.getState().composer).toEqual({
      kind: 'card',
      listId: TODO_LIST,
      index: 1,
    });
  });

  it('quick edits with E and selects the title with T', () => {
    mount();
    set(() => useUiStore.getState().setHoveredCardId(FIRST));

    press('E');
    expect(useUiStore.getState().quickEditCardId).toBe(FIRST);
    expect(useUiStore.getState().quickEditSelectsTitle).toBe(false);

    press('T');
    expect(useUiStore.getState().quickEditSelectsTitle).toBe(true);
  });

  it('anchors a card panel to the tile, and to the modal sidebar row when it exists', () => {
    const tile = anchor(`card-${String(FIRST)}`);
    mount();
    set(() => useUiStore.getState().setHoveredCardId(FIRST));

    press('L');
    expect(useUiStore.getState().openPopover).toMatchObject({
      kind: 'labels',
      anchor: tile,
      props: { cardId: FIRST, shortcut: true },
    });

    const row = anchor('dates');
    set(() => useUiStore.getState().setOpenPopover(null));
    set(() => useUiStore.getState().setOpenCardId(FIRST));
    press('D');
    expect(useUiStore.getState().openPopover).toMatchObject({ kind: 'dates', anchor: row });
    expect(useUiStore.getState().openPopover?.props).toBeUndefined();
  });

  it('toggles the first label of the board with 1', async () => {
    const seen: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method !== 'GET') seen.push(`${request.method} ${new URL(request.url).pathname}`);
    });
    mount();
    set(() => useUiStore.getState().setHoveredCardId(FIRST));

    // Card 101 already carries labels 31 and 32, so the key detaches the first of them.
    press('1');

    await waitFor(() => expect(seen).toContain('DELETE /api/cards/101/labels/31'));
    server.events.removeAllListeners();
  });

  it('archives the current card with C', async () => {
    const seen: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST') seen.push(new URL(request.url).pathname);
    });
    mount();
    set(() => useUiStore.getState().setHoveredCardId(FIRST));

    press('C');

    await waitFor(() => expect(seen).toContain('/api/cards/101/archive'));
    server.events.removeAllListeners();
  });

  it('sends the card to the top of the neighbouring list with "," and "."', async () => {
    const moves: string[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method !== 'POST') return;
      const url = new URL(request.url).pathname;
      if (url.endsWith('/move')) moves.push(`${url} ${await request.clone().text()}`);
    });
    mount();
    set(() => useUiStore.getState().setHoveredCardId(OTHER_LIST_CARD));

    press(',');

    await waitFor(() => expect(moves).toHaveLength(1));
    expect(moves[0]).toContain('/api/cards/103/move');
    expect(moves[0]).toContain('"to_list_id":11');
    expect(moves[0]).toContain('"index":0');
    server.events.removeAllListeners();
  });
});
