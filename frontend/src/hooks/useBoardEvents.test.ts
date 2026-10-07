import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardEvent } from '@/api/types';
import { normalizeBoard } from '@/lib/normalize';
import { useUiStore } from '@/store/uiStore';
import { boardPayloadFixture } from '@/test/handlers';
import { activityKey } from './useBoardActivity';
import { boardKey } from './useBoardData';
import { cardKey } from './useCard';
import { useBoardEvents } from './useBoardEvents';

/** The stand-in of `api/events.test.ts`: jsdom has no `EventSource`. */
class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];

  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }

  close(): void {
    // The hook only cares that the frames stop, which dropping the reference already does.
  }
}

const BOARD_ID = boardPayloadFixture.board.id;
const CARD_ID = 101;

function event(overrides: Partial<BoardEvent> = {}): BoardEvent {
  return {
    version: 2,
    type: 'card.renamed',
    entity: 'card',
    id: CARD_ID,
    card_id: CARD_ID,
    at: '2026-09-25T09:00:00.000Z',
    ...overrides,
  };
}

function emit(payload: BoardEvent): void {
  const source = FakeEventSource.instances.at(-1);
  if (source === undefined) throw new Error('the hook opened no stream');
  act(() => {
    source.dispatchEvent(new MessageEvent(payload.type, { data: JSON.stringify(payload) }));
  });
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

function mount() {
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const { unmount } = renderHook(() => useBoardEvents(BOARD_ID), { wrapper });
  return { invalidate, unmount };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  // The board is cached at version 1, which is the gate's left-hand side.
  queryClient.setQueryData(boardKey(BOARD_ID), normalizeBoard(boardPayloadFixture));
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, 'EventSource');
  useUiStore.setState({ isDragging: false, queuedEvents: [], realtimeStatus: 'live' });
  queryClient.clear();
});

describe('useBoardEvents', () => {
  it('ignores an event at or below the cached version', () => {
    const { invalidate, unmount } = mount();

    emit(event({ version: 1 }));
    act(() => void vi.advanceTimersByTime(1_000));

    expect(invalidate).not.toHaveBeenCalled();
    unmount();
  });

  it('invalidates the card and the feed at once, and the board after the debounce', () => {
    const { invalidate, unmount } = mount();

    emit(event({ version: 2 }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: cardKey(CARD_ID) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: activityKey(BOARD_ID) });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: boardKey(BOARD_ID) });

    act(() => void vi.advanceTimersByTime(150));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: boardKey(BOARD_ID) });
    unmount();
  });

  it('invalidates the board immediately on a version gap and on a resync', () => {
    const { invalidate, unmount } = mount();

    emit(event({ version: 5 }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: boardKey(BOARD_ID) });

    invalidate.mockClear();
    emit(event({ version: 1, type: 'resync', entity: 'board', card_id: undefined }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: boardKey(BOARD_ID) });
    unmount();
  });

  it('queues events while a drag is live and applies them on drop', () => {
    const { invalidate, unmount } = mount();
    act(() => useUiStore.setState({ isDragging: true }));

    emit(event({ version: 2 }));
    expect(invalidate).not.toHaveBeenCalled();
    expect(useUiStore.getState().queuedEvents).toHaveLength(1);

    act(() => useUiStore.setState({ isDragging: false }));
    expect(useUiStore.getState().queuedEvents).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: cardKey(CARD_ID) });
    unmount();
  });

  it('reports the connection state and clears it when the board closes', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result, unmount } = renderHook(() => useBoardEvents(BOARD_ID), { wrapper });

    expect(result.current).toBe('live');
    act(() => useUiStore.setState({ realtimeStatus: 'polling' }));
    expect(result.current).toBe('polling');

    unmount();
    expect(useUiStore.getState().realtimeStatus).toBe('live');
    expect(invalidate).not.toHaveBeenCalled();
  });
});
