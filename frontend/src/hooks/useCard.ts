/**
 * The one query the card detail modal reads (Section 5.4.1).
 *
 * `['card', cardId]` is the whole document `CardDetailModal` renders — the card plus its
 * description, dates, board and list names and its items — so the modal opens on one request
 * instead of stitching the board payload together with four more. The modal's activity feed is
 * the board's own, narrowed by `card_id`, so it lives in `hooks/useBoardActivity.ts` beside
 * the drawer's.
 *
 * Unlike the board query this one is not polled: `useBoardEvents` invalidates `['card', cardId]`
 * for every event carrying this `card_id` (Section 5.4.3), and `hooks/useCardMutations.ts`
 * writes its own responses straight into the caches meanwhile.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getCardDetail } from '@/api/cards';
import type { CardDetail } from '@/api/types';
import { isId } from '@/lib/boardState';

/** The detail key of Section 5.4.1; `useCardMutations` patches the same entry. */
export function cardKey(cardId: number): readonly ['card', number] {
  return ['card', cardId] as const;
}

/** The board query's freshness window, shared so the modal and the tile agree (Section 5.4.1). */
const STALE_MS = 30_000;

/**
 * `GET /api/cards/{card_id}` — the modal's whole document. An archived card is returned too, so
 * the modal can show the banner, and a card that has moved to another board answers with its new
 * `board_id`, which is what makes the URL replace itself (Section 2.6.1).
 */
export function useCardDetail(cardId: number): UseQueryResult<CardDetail, Error> {
  return useQuery({
    queryKey: cardKey(cardId),
    queryFn: () => getCardDetail(cardId),
    enabled: isId(cardId),
    staleTime: STALE_MS,
  });
}
