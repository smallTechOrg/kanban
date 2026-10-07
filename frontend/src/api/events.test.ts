import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '@/test/server';
import type { BoardEvent } from './types';
import { POLL_MS, SSE_RETRY_MS, connectBoardEvents, type RealtimeStatus } from './events';

/**
 * jsdom implements no `EventSource`, which is also why `connectBoardEvents` looks the constructor
 * up on `globalThis` instead of closing over it: this stand-in records what was opened and lets a
 * test dispatch the frames and the error the real object would.
 */
class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  isClosed = false;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.isClosed = true;
  }

  static get last(): FakeEventSource {
    const source = FakeEventSource.instances.at(-1);
    if (source === undefined) throw new Error('no stream was opened');
    return source;
  }
}

function emit(type: string, payload: unknown): void {
  FakeEventSource.last.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(payload) }));
}

function emitRaw(type: string, data: string): void {
  FakeEventSource.last.dispatchEvent(new MessageEvent(type, { data }));
}

function fail(): void {
  FakeEventSource.last.dispatchEvent(new Event('error'));
}

function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });
}

const BOARD_ID = 7;

function event(overrides: Partial<BoardEvent> = {}): BoardEvent {
  return {
    version: 2,
    type: 'card.renamed',
    entity: 'card',
    id: 101,
    card_id: 101,
    at: '2026-09-25T09:00:00.000Z',
    ...overrides,
  };
}

let events: BoardEvent[][];
let statuses: RealtimeStatus[];
let version: number;

function connect(): { close: () => void } {
  return connectBoardEvents(BOARD_ID, {
    since: () => version,
    onEvents: (batch) => events.push(batch),
    onStatus: (status) => statuses.push(status),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  events = [];
  statuses = [];
  version = 1;
  setOnline(true);
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, 'EventSource');
});

describe('connectBoardEvents', () => {
  it('opens the stream at the cached version and reports what arrives', () => {
    const connection = connect();

    expect(FakeEventSource.last.url).toBe('/api/boards/7/events?since=1');
    emit('hello', event({ type: 'hello', entity: 'board', id: BOARD_ID, card_id: undefined }));
    emit('card.renamed', event());

    expect(statuses).toEqual(['live']);
    expect(events).toHaveLength(2);
    expect(events[1]?.[0]?.type).toBe('card.renamed');
    connection.close();
  });

  it('drops a frame it cannot read instead of throwing', () => {
    const connection = connect();

    emitRaw('card.renamed', 'not json');
    emit('card.renamed', { nothing: true });
    FakeEventSource.last.dispatchEvent(new Event('card.renamed'));

    expect(events).toEqual([]);
    connection.close();
  });

  it('reconnects 1 s, 2 s, 4 s and then polls, which the next hello stops', async () => {
    const connection = connect();

    fail();
    expect(statuses).toEqual(['reconnecting']);
    expect(FakeEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    fail();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeEventSource.instances).toHaveLength(3);

    fail();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(FakeEventSource.instances).toHaveLength(4);

    // The third failed reconnect: the banner's trigger, about 7 s after the drop.
    fail();
    expect(statuses.at(-1)).toBe('polling');
    await vi.advanceTimersByTimeAsync(0);
    expect(events.at(-1)?.[0]?.type).toBe('card.renamed');

    // The stream is still retried every 30 s while polling, and `hello` ends both.
    const polled = events.length;
    await vi.advanceTimersByTimeAsync(SSE_RETRY_MS);
    expect(events.length).toBeGreaterThan(polled);
    expect(FakeEventSource.instances).toHaveLength(5);

    version = 2;
    emit('hello', event({ version: 2, type: 'hello', entity: 'board', card_id: undefined }));
    expect(statuses.at(-1)).toBe('live');
    const settled = events.length;
    await vi.advanceTimersByTimeAsync(3 * POLL_MS);
    expect(events).toHaveLength(settled);

    connection.close();
  });

  it('turns a polled resync into one event the caller can gate on', async () => {
    server.use(
      http.get('/api/boards/:boardId/changes', () =>
        HttpResponse.json({ version: 9, events: [], resync: true }),
      ),
    );
    const connection = connect();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      fail();
      await vi.advanceTimersByTimeAsync(4_000);
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(events.at(-1)).toEqual([
      expect.objectContaining({ type: 'resync', entity: 'board', version: 9, id: BOARD_ID }),
    ]);
    connection.close();
  });

  it('opens nothing while the browser is offline, and resumes on the online event', async () => {
    setOnline(false);
    const connection = connect();
    expect(FakeEventSource.instances).toHaveLength(0);

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    expect(FakeEventSource.instances).toHaveLength(1);

    window.dispatchEvent(new Event('offline'));
    expect(FakeEventSource.last.isClosed).toBe(true);
    await vi.advanceTimersByTimeAsync(SSE_RETRY_MS);
    expect(FakeEventSource.instances).toHaveLength(1);

    connection.close();
  });

  it('stops every timer on close', async () => {
    const connection = connect();
    fail();
    connection.close();

    await vi.advanceTimersByTimeAsync(10 * SSE_RETRY_MS);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.last.isClosed).toBe(true);
    expect(events).toEqual([]);
  });

  it('does nothing at all where the browser has no EventSource', () => {
    Reflect.deleteProperty(globalThis, 'EventSource');
    const connection = connect();

    expect(FakeEventSource.instances).toHaveLength(0);
    connection.close();
  });
});
