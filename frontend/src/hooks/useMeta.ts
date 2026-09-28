/**
 * `GET /api/meta`: the palettes, limits and flags the client renders instead of holding a
 * second hard-coded copy (CLAUDE.md section 3). The only place this query is declared —
 * components never call `useQuery` inline.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getMeta } from '@/api/meta';
import type { Meta } from '@/api/types';

const META_KEY = ['meta'] as const;

/** Section 5.4.1: `staleTime: Infinity`, because the palettes change only with the server. */
export function useMeta(): UseQueryResult<Meta, Error> {
  return useQuery({
    queryKey: META_KEY,
    queryFn: getMeta,
    staleTime: Infinity,
  });
}
