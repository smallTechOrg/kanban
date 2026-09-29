/**
 * The board payload turned into the normalised cache shape of Section 5.4.2, and back.
 *
 * `GET /api/boards/{board_id}` answers with arrays; the board query normalises them once per
 * response so every selector in `hooks/useBoardData.ts` reads a map lookup and one card change
 * re-renders one `CardTile` (Sections 5.4.2 and 5.11). The ordering rule is the server's own:
 * active rows sorted by `(position, id)` (`boardState.byPosition`).
 *
 * `denormalizeBoard` is the exact inverse for any state whose order arrays agree with the
 * positions — which is every state built from a payload or merged from a server response — and
 * it is what lets `normalize.test.ts` prove the normaliser loses nothing.
 */
import { byPosition } from './boardState';
import type { BoardDocument, BoardState, CardRow, Id, LabelRow, ListRow } from './boardState';

function byId<T extends { id: Id }>(rows: readonly T[]): Record<Id, T> {
  const map: Record<Id, T> = {};
  for (const row of rows) map[row.id] = row;
  return map;
}

/** The board document as one `BoardState`. Archived rows are kept out of the order arrays. */
export function normalizeBoard(payload: BoardDocument): BoardState {
  const lists = [...payload.lists].sort(byPosition);
  const cards = [...payload.cards].sort(byPosition);

  const cardOrder: Record<Id, Id[]> = {};
  for (const list of lists) cardOrder[list.id] = [];
  for (const card of cards) {
    if (card.is_archived) continue;
    const ids = cardOrder[card.list_id];
    if (ids === undefined) cardOrder[card.list_id] = [card.id];
    else ids.push(card.id);
  }

  return {
    board: payload.board,
    lists: byId(lists),
    cards: byId(cards),
    labels: byId(payload.labels),
    listOrder: lists.filter((list) => !list.is_archived).map((list) => list.id),
    cardOrder,
  };
}

/** The inverse: the arrays a `GET /api/boards/{board_id}` response would have carried. */
export function denormalizeBoard(state: BoardState): BoardDocument {
  const lists: ListRow[] = Object.values(state.lists).sort(byPosition);
  const cards: CardRow[] = Object.values(state.cards).sort(byPosition);
  const labels: LabelRow[] = Object.values(state.labels).sort(byPosition);
  return { board: state.board, labels, lists, cards };
}
