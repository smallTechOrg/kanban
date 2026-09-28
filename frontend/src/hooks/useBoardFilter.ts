/**
 * The board filter as the board page uses it: the predicate bound to this board's labels,
 * members and signed-in user, and the mirror between `uiStore.filter` and the URL query
 * (Sections 2.3.3 and 5.13).
 *
 * Not one filter rule is written here. `lib/filter.ts` owns `matchesFilter`, the active count and
 * the URL schema; this module only supplies the context that a pure function cannot reach — the
 * board's `labelsById` / `membersById` maps, `['me']` and the clock — so that `CardList` (which
 * hides a tile) and `ListColumn` (which counts the survivors for the list header) evaluate the
 * same rule from the same place.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Id } from '@/lib/boardState';
import {
  filterFromSearchParams,
  filterToSearchParams,
  isFilterActive,
  matchesFilter,
  type FilterCard,
  type FilterLabel,
  type FilterMember,
} from '@/lib/filter';
import { useUiStore } from '@/store/uiStore';
import { useMe } from './useAuth';
import { useLabels, useMembers } from './useBoardData';

/** What a caller needs to hide a tile and to count the ones that stay. */
export interface BoardFilterState {
  /** Whether anything is selected at all: no filter means no hidden tiles and no count. */
  active: boolean;
  /** Whether one card survives the filter (`true` while nothing is selected). */
  matches: (card: FilterCard) => boolean;
}

function byId<T extends { id: Id }, R>(
  rows: readonly T[] | undefined,
  pick: (row: T) => R,
): Record<Id, R> {
  const map: Record<Id, R> = {};
  for (const row of rows ?? []) map[row.id] = pick(row);
  return map;
}

/**
 * The filter predicate for one board. `now` is read at call time, so a "Due in the next day"
 * filter left open over midnight answers for the moment the tile is painted rather than for the
 * moment the popover was closed.
 */
export function useBoardFilter(boardId: number): BoardFilterState {
  const filter = useUiStore((state) => state.filter);
  const labels = useLabels(boardId).data;
  const members = useMembers(boardId).data;
  const meId = useMe().data?.id ?? null;

  const labelsById = useMemo<Record<Id, FilterLabel>>(
    () => byId(labels, (label) => ({ name: label.name })),
    [labels],
  );
  const membersById = useMemo<Record<Id, FilterMember>>(
    () => byId(members, (member) => ({ full_name: member.full_name, username: member.username })),
    [members],
  );

  const matches = useCallback(
    (card: FilterCard) =>
      matchesFilter(card, filter, { now: new Date(), labelsById, membersById, meId }),
    [filter, labelsById, membersById, meId],
  );

  return { active: isFilterActive(filter), matches };
}

/**
 * Keeps `uiStore.filter` and the URL query in step, in both directions (Section 2.3.3): a
 * reloaded or shared `?q=launch&due=overdue` link opens the board already filtered, every change
 * the popover makes is written back with `replace` (so the filter never fills the Back history),
 * and the Back button itself puts the previous filter into the store.
 *
 * Mounted once per board, by `BoardHeader`, because the mirror has to work while the popover is
 * closed. The store is global and outlives one board, so the URL wins on mount: opening a second
 * board clears the filter the first one was wearing.
 */
export function useFilterUrlSync(): void {
  const [params, setParams] = useSearchParams();
  const filter = useUiStore((state) => state.filter);
  const setFilter = useUiStore((state) => state.setFilter);

  // Both sides compared in one canonical form, so `?match=any` (a default spelled out) or a
  // different key order does not read as a change and start a loop.
  const fromStore = filterToSearchParams(filter).toString();
  const fromUrl = filterToSearchParams(filterFromSearchParams(params)).toString();

  /** The canonical string this hook last synced; `null` until the first pass adopts the URL. */
  const synced = useRef<string | null>(null);

  useEffect(() => {
    if (fromUrl === fromStore) {
      synced.current = fromStore;
      return;
    }
    // On mount, and whenever the store still holds what we last wrote, the URL is the new
    // information — a reload, a pasted link or the Back button. Otherwise the popover changed
    // the store and the URL has to follow.
    if (synced.current === null || synced.current === fromStore) {
      synced.current = fromUrl;
      setFilter(filterFromSearchParams(new URLSearchParams(fromUrl)));
    } else {
      synced.current = fromStore;
      setParams(new URLSearchParams(fromStore), { replace: true });
    }
  }, [fromStore, fromUrl, setFilter, setParams]);
}
