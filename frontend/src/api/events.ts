/**
 * The realtime transport: one `EventSource`, its reconnect schedule and the polling fallback
 * (Sections 4.8, 5.4.3 and 2.10). The one schedule all three of those sections describe lives
 * here, so no component or hook counts a retry itself.
 *
 * The stream drops -> close it and reconnect with `?since=<cached version>` after 1 s, 2 s, 4 s
 * and then every 30 s. The third *failed reconnect* (about 7 s after the drop) switches to polling
 * `GET /api/boards/{board_id}/changes?since=` every 5 s, which is exactly the moment the
 * "Reconnecting..." banner of Section 2.10 appears, and the stream is still retried every 30 s
 * while polling; the next `hello` clears the polling timer and the banner. Both timers pause while
 * `navigator.onLine` is false and resume on the `online` event.
 *
 * **Events are notifications, not patches** (Section 4.8): this module parses frames and reports
 * them, and never touches a cache. The version gate, the debounce and the invalidation are
 * `hooks/useBoardEvents.ts`'s, which is this module's only caller.
 */
import { api } from './client';
import type { BoardEvent, Changes } from './types';

/**
 * The connection state the banner reads (Section 5.13 `uiStore.realtimeStatus`). It is declared
 * here because this module is what decides the transitions: `live` while a stream is attached,
 * `reconnecting` during the three backoff attempts, `polling` from the third failed reconnect
 * until the next `hello`.
 */
export type RealtimeStatus = 'live' | 'reconnecting' | 'polling';

/** The two synthetic event types of Section 4.8: the version on connect, and "you fell behind". */
export const HELLO = 'hello';
export const RESYNC = 'resync';

/** Section 4.8: 1 s, 2 s, 4 s, then every 30 s (capped). */
export const SSE_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000];
export const SSE_RETRY_MS = 30_000;

/** How often `/changes` is read once the stream has given up (Section 4.8). */
export const POLL_MS = 5_000;

/**
 * `client.ts` owns `fetch`, but an `EventSource` is not a `fetch`: it is the only transport that
 * sends `Last-Event-ID` on its own, which is half of Section 4.8's cursor, so the stream is opened
 * here with the same `/api` prefix every call in this directory uses.
 */
const API_BASE = '/api';

/**
 * The `event:` names to listen for. `EventSource` dispatches every frame under its own name and
 * the DOM offers no wildcard listener, so the closed `ACTIVITY_TYPES` list of Section 3.8 is
 * enumerated once here, plus the two synthetic types. Nothing branches on the name — every frame
 * is handled by its payload — so a type a newer server adds is only missed until the board
 * query's own 30 s refetch (`hooks/useBoardData.ts`), never mishandled.
 */
const EVENT_TYPES: readonly string[] = [
  HELLO,
  RESYNC,
  'board.created',
  'board.renamed',
  'board.description_changed',
  'board.visibility_changed',
  'board.background_changed',
  'board.closed',
  'board.reopened',
  'member.added',
  'member.removed',
  'member.role_changed',
  'list.created',
  'list.renamed',
  'list.moved',
  'list.moved_out',
  'list.moved_in',
  'list.copied',
  'list.archived',
  'list.unarchived',
  'list.color_changed',
  'card.created',
  'card.copied',
  'card.renamed',
  'card.description_changed',
  'card.moved',
  'card.reordered',
  'card.moved_out',
  'card.moved_in',
  'card.archived',
  'card.unarchived',
  'card.deleted',
  'card.due_set',
  'card.due_removed',
  'card.due_completed',
  'card.due_incompleted',
  'card.cover_changed',
  'card.cover_removed',
  'card.template_set',
  'card.template_unset',
  'card.label_added',
  'card.label_removed',
  'card.member_added',
  'card.member_removed',
  'card.watched',
  'card.unwatched',
  'label.created',
  'label.updated',
  'label.deleted',
  'checklist.added',
  'checklist.renamed',
  'checklist.deleted',
  'checklist.moved',
  'checklist.item_added',
  'checklist.item_renamed',
  'checklist.item_deleted',
  'checklist.item_checked',
  'checklist.item_unchecked',
  'checklist.item_due_set',
  'checklist.item_due_removed',
  'checklist.item_assigned',
  'checklist.item_unassigned',
  'checklist.item_moved',
  'checklist.item_converted',
  'attachment.added',
  'attachment.renamed',
  'attachment.deleted',
  'comment.added',
  'comment.edited',
  'comment.deleted',
];

export interface BoardEventsHandlers {
  /** The client's cached `board.version`, read afresh for every connect and every poll. */
  since: () => number;
  /** Frames as they arrive, in order. The version gate and the invalidation are the caller's. */
  onEvents: (events: BoardEvent[]) => void;
  onStatus: (status: RealtimeStatus) => void;
}

export interface BoardEventsConnection {
  /** Closes the stream and stops every timer. Calling it twice is safe. */
  close: () => void;
}

function isBoardEvent(value: unknown): value is BoardEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Partial<BoardEvent>;
  return typeof event.version === 'number' && typeof event.type === 'string';
}

/** One frame's `data`, or `null` for a body this client cannot read (never a thrown error). */
function parseFrame(data: unknown): BoardEvent | null {
  if (typeof data !== 'string') return null;
  try {
    const value: unknown = JSON.parse(data);
    return isBoardEvent(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The `resync` of a polled page as an event, so the caller has one channel to gate and one rule
 * for "refetch the board outright" whether the stream or the poll reported it (Section 5.4.3).
 */
function resyncEvent(boardId: number, version: number): BoardEvent {
  return {
    version,
    type: RESYNC,
    entity: 'board',
    id: boardId,
    actor_id: null,
    at: new Date().toISOString(),
  };
}

/** `GET /api/boards/{board_id}/changes?since=` — the polling fallback (Sections 4.3 and 4.8). */
function getChanges(boardId: number, since: number): Promise<Changes> {
  return api.get<Changes>(`/boards/${boardId}/changes?since=${since}`);
}

/**
 * Subscribe to one board's changes until `close()`.
 *
 * `EventSource` is looked up on `globalThis` at connect time: an environment without it (jsdom,
 * so every component test) gets a connection that opens nothing and starts no timer, rather than
 * a `ReferenceError` on mount or a test suite that polls.
 */
export function connectBoardEvents(
  boardId: number,
  handlers: BoardEventsHandlers,
): BoardEventsConnection {
  const { since, onEvents, onStatus } = handlers;

  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Errors since the last `hello`: 1 is the drop itself, 4 is the third failed reconnect. */
  let failures = 0;
  let polling = false;
  let pollInFlight = false;
  let closed = false;

  function closeStream(): void {
    if (source === null) return;
    source.close();
    source = null;
  }

  function clearReconnect(): void {
    if (reconnectTimer === null) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function clearPollTimer(): void {
    if (pollTimer === null) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function poll(): void {
    if (closed || pollInFlight) return;
    pollInFlight = true;
    void getChanges(boardId, since())
      .then((changes) => {
        if (closed) return;
        onEvents(changes.resync ? [resyncEvent(boardId, changes.version)] : changes.events);
      })
      .catch(() => {
        // The banner is already up and the next tick tries again; a failed poll is not an event.
      })
      .finally(() => {
        pollInFlight = false;
      });
  }

  function startPollTimer(): void {
    if (pollTimer !== null) return;
    pollTimer = setInterval(poll, POLL_MS);
  }

  /** The switch of Section 2.10: poll at once so the board catches up, then every 5 s. */
  function startPolling(): void {
    if (polling) return;
    polling = true;
    startPollTimer();
    poll();
  }

  function stopPolling(): void {
    polling = false;
    clearPollTimer();
  }

  function onFrame(event: Event): void {
    if (!(event instanceof MessageEvent)) return;
    const payload = parseFrame(event.data);
    if (payload === null) return;
    if (payload.type === HELLO) {
      failures = 0;
      stopPolling();
      onStatus('live');
    }
    onEvents([payload]);
  }

  function onError(): void {
    if (closed) return;
    closeStream();
    failures += 1;
    if (failures > SSE_BACKOFF_MS.length) startPolling();
    onStatus(polling ? 'polling' : 'reconnecting');
    clearReconnect();
    reconnectTimer = setTimeout(openStream, SSE_BACKOFF_MS[failures - 1] ?? SSE_RETRY_MS);
  }

  function openStream(): void {
    reconnectTimer = null;
    if (closed || navigator.onLine === false) return;
    const Source = globalThis.EventSource;
    if (Source === undefined) return;
    closeStream();
    const stream = new Source(`${API_BASE}/boards/${boardId}/events?since=${since()}`, {
      withCredentials: true,
    });
    for (const type of EVENT_TYPES) stream.addEventListener(type, onFrame);
    stream.addEventListener('error', onError);
    source = stream;
  }

  /** Offline: hold both timers where they are; `polling` survives so `online` resumes into it. */
  function pause(): void {
    closeStream();
    clearReconnect();
    clearPollTimer();
  }

  function resume(): void {
    if (closed) return;
    if (polling) startPollTimer();
    openStream();
  }

  window.addEventListener('offline', pause);
  window.addEventListener('online', resume);
  openStream();

  return {
    close: () => {
      closed = true;
      window.removeEventListener('offline', pause);
      window.removeEventListener('online', resume);
      pause();
      stopPolling();
    },
  };
}
