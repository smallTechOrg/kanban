/**
 * The realtime subscription, mounted while a board is open (Sections 4.8 and 5.4.3).
 *
 * **Events are notifications, not patches.** Nothing here writes a cache entry from an event
 * payload — `BoardEvent` carries no titles, bodies or rows. Every accepted event turns into an
 * invalidation and nothing else, so the only writes into the board cache stay the client's own
 * mutation responses.
 *
 * The rules, all from Section 5.4.3:
 *
 * - **Version gate.** An event whose `version` is at or below the cached `board.version` is
 *   ignored: it is this client's own echo of a response it has already merged.
 * - **Debounce.** An accepted event schedules one `['board', boardId]` invalidation 150 ms later,
 *   so a burst (somebody dragging, a paste of ten cards) costs one refetch.
 * - **Gap.** `version > cached + 1` means something was missed, and a `resync` means far more than
 *   that, so both invalidate at once instead of waiting out the debounce.
 * - **Cards.** An event carrying a `card_id` also invalidates `['card', card_id]`, and any
 *   accepted event invalidates `['activity', boardId]` — the prefix of the drawer's feed and of
 *   every card's — because the row it describes is the feed's newest entry.
 * - **Drags.** While `uiStore.isDragging` is true the events are queued in the store and applied on
 *   drop, so a refetch never pulls the board out from under a lift.
 *
 * The connection itself — the backoff, the polling fallback and the online/offline pauses — is
 * `api/events.ts`. This hook only mirrors its status into `uiStore.realtimeStatus`, which is what
 * renders the "Reconnecting…" banner of Section 2.10.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { connectBoardEvents, RESYNC, type RealtimeStatus } from '@/api/events';
import type { BoardEvent } from '@/api/types';
import { isId, type BoardState } from '@/lib/boardState';
import { useUiStore } from '@/store/uiStore';
import { activityKey } from './useBoardActivity';
import { boardKey, invalidateBoard } from './useBoardData';
import { cardKey } from './useCard';

/** Section 5.4.3: one board refetch per 150 ms of events. */
const INVALIDATE_DEBOUNCE_MS = 150;

/** What a batch of events asks of the board query. */
type BoardRefetch = 'none' | 'debounced' | 'now';

/**
 * Subscribe to `boardId` for as long as the caller is mounted, and report the connection state
 * (also in `uiStore.realtimeStatus`, where the banner reads it).
 */
export function useBoardEvents(boardId: number): RealtimeStatus {
  const queryClient = useQueryClient();
  const status = useUiStore((state) => state.realtimeStatus);
  const setRealtimeStatus = useUiStore((state) => state.setRealtimeStatus);
  const isDragging = useUiStore((state) => state.isDragging);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** The gate's left-hand side, and the `?since=` of every connect and poll. */
  const cachedVersion = useCallback(
    () => queryClient.getQueryData<BoardState>(boardKey(boardId))?.board.version ?? 0,
    [queryClient, boardId],
  );

  const clearDebounce = useCallback(() => {
    if (debounceTimer.current === null) return;
    clearTimeout(debounceTimer.current);
    debounceTimer.current = null;
  }, []);

  const applyEvents = useCallback(
    (events: BoardEvent[]): void => {
      const store = useUiStore.getState();
      if (store.isDragging) {
        for (const event of events) store.queueEvent(event);
        return;
      }

      const cached = cachedVersion();
      let refetch: BoardRefetch = 'none';
      for (const event of events) {
        if (event.type === RESYNC) {
          refetch = 'now';
          continue;
        }
        if (event.version <= cached) continue;
        refetch = refetch === 'now' || event.version > cached + 1 ? 'now' : 'debounced';
        void queryClient.invalidateQueries({ queryKey: activityKey(boardId) });
        if (event.card_id !== undefined) {
          void queryClient.invalidateQueries({ queryKey: cardKey(event.card_id) });
        }
      }

      if (refetch === 'now') {
        clearDebounce();
        invalidateBoard(queryClient, boardId);
        return;
      }
      if (refetch === 'debounced' && debounceTimer.current === null) {
        debounceTimer.current = setTimeout(() => {
          debounceTimer.current = null;
          invalidateBoard(queryClient, boardId);
        }, INVALIDATE_DEBOUNCE_MS);
      }
    },
    [boardId, cachedVersion, clearDebounce, queryClient],
  );

  // The drop: whatever arrived during the lift is applied in one go (Section 5.5).
  useEffect(() => {
    if (isDragging) return;
    const queued = useUiStore.getState().takeQueuedEvents();
    if (queued.length > 0) applyEvents(queued);
  }, [isDragging, applyEvents]);

  useEffect(() => {
    if (!isId(boardId)) return;
    const connection = connectBoardEvents(boardId, {
      since: cachedVersion,
      onEvents: applyEvents,
      onStatus: setRealtimeStatus,
    });
    return () => {
      connection.close();
      clearDebounce();
      // Leaving the board ends the subscription, so the banner must not outlive it.
      setRealtimeStatus('live');
    };
  }, [boardId, cachedVersion, applyEvents, clearDebounce, setRealtimeStatus]);

  return status;
}
