/**
 * `['search', q]` — the query behind `SearchPopover` (Sections 2.1.1 and 5.4.1).
 *
 * The debounce lives here rather than in the popover: the 250 ms of Section 2.1.1 and the
 * "two characters before anything is sent" of Section 5.4.1 are one rule about the search query,
 * and a component that owned its own timer would hold server state in a `useState`. The typed text
 * comes in as a prop, the debounced term goes back out, so the empty state of Section 2.10 can
 * print the term the rows actually belong to instead of the half-typed one.
 *
 * `placeholderData: keepPreviousData` keeps the previous rows on screen while the next answer is on
 * its way, which is what stops the panel collapsing between keystrokes.
 */
import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { search } from '@/api/search';
import type { SearchResults } from '@/api/types';

/** Section 2.1.1: typing is debounced by 250 ms before a request goes out. */
export const SEARCH_DEBOUNCE_MS = 250;

/** Section 5.4.1: `enabled: q.length >= 2`. One character matches almost everything. */
export const MIN_SEARCH_LENGTH = 2;

/** A search is re-read whenever the popover is opened again, like the other short-lived lists. */
const SEARCH_STALE_MS = 10_000;

/** The key of Section 5.4.1. */
export function searchKey(q: string): readonly ['search', string] {
  return ['search', q] as const;
}

export interface SearchState {
  /** The two groups, or `undefined` while nothing has been searched for yet. */
  results: SearchResults | undefined;
  /** The debounced term the rows belong to: what "We couldn't find anything matching" prints. */
  term: string;
  /** True while a request for the current term is on the wire. */
  isFetching: boolean;
  /** False while fewer than two characters are typed, when nothing is sent and nothing shows. */
  isEnabled: boolean;
}

/** The debounced search behind the top-bar input. `input` is the raw value of that field. */
export function useSearch(input: string): SearchState {
  const typed = input.trim();
  const [term, setTerm] = useState(typed);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(typed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const isEnabled = term.length >= MIN_SEARCH_LENGTH;
  const { data, isFetching } = useQuery({
    queryKey: searchKey(term),
    queryFn: () => search(term),
    enabled: isEnabled,
    placeholderData: keepPreviousData,
    staleTime: SEARCH_STALE_MS,
  });

  return {
    results: isEnabled ? data : undefined,
    term,
    isFetching: isEnabled && isFetching,
    isEnabled,
  };
}
