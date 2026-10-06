"""The single round-trip board document (Sections 4.3, 4.10.1 and 6.7).

`GET /api/boards/{board_id}` is the only read the board page makes, so the whole `BoardPayload`
is assembled here in exactly **five statements**, whatever the board holds: the board, its labels,
the active lists, one cards query whose `label_ids` come from a correlated sub-select, and every
item of every one of those cards. Nothing in this module iterates a query, so 30 lists x 100
cards costs the same five round trips as an empty board (Section 4.10.1: under 100 ms for that
board).

Raw SQL lives here by design (CLAUDE.md section 2). An ORM expression of the cards statement
would either fan every card out across its labels or fall back to a query per card.

Only *active* rows reach the client: the lists statement filters `is_archived = 0` and the cards
statement joins `lists` to filter `lists.is_archived = 0 AND cards.is_archived = 0`, so a card
inside an archived list is absent from the payload and comes back with the list when it is sent
to the board (Sections 3.7 and 4.3).

The row shapes are the `BoardSummary` and `LabelOut` of Section 4.3, the `ListOut` of
Section 4.4 and the `CardSummary` of Section 4.5. The two that `services/boards.py` already
builds are reused from there rather than restated.
"""

from collections.abc import Mapping
from typing import Any, Final

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from kanban.errors import NotFound
from kanban.models import Board
from kanban.services.boards import board_summary, list_labels

#: Statement 3: the board's active lists in `position` order (Section 4.4).
_LISTS_SQL: Final[str] = """
SELECT id, board_id, name, position, color, is_archived, created_at, updated_at
  FROM lists
 WHERE board_id = :board_id
   AND is_archived = 0
 ORDER BY position, id
"""

#: Statement 4: every active card of every active list (Section 4.10.1).
#:
#: `description` is Markdown and only its emptiness is a badge, so the body never leaves the
#: database here; the card modal fetches it. The two item counts are not read here: statement 5
#: returns the rows they count, so `_card` derives them from the array it is handed and a tile's
#: item list and its `done/total` cannot disagree.
_CARDS_SQL: Final[str] = """
SELECT c.id,
       c.client_id,
       c.board_id,
       c.list_id,
       c.short_id,
       c.title,
       c.position,
       c.is_archived,
       c.start_at,
       c.due_at,
       c.due_complete,
       c.created_at,
       c.updated_at,
       c.description <> '' AS has_description,
       (SELECT GROUP_CONCAT(cl.label_id) FROM card_labels cl WHERE cl.card_id = c.id) AS label_ids
  FROM cards c
  JOIN lists l ON l.id = c.list_id
 WHERE c.board_id = :board_id
   AND c.is_archived = 0
   AND l.is_archived = 0
 ORDER BY c.position, c.id
"""

#: Statement 5: the items of every card statement 4 returns, in the order a card reads them.
#:
#: Section 2.5.1 puts a card's items on its tile, so the board document carries them: one scan of
#: `card_items` for the whole board rather than the per-card read a 3,000-card fixture would turn
#: into 3,000 of. The `WHERE` is statement 4's, so a card absent from the payload brings no items.
_ITEMS_SQL: Final[str] = """
SELECT i.id, i.card_id, i.name, i.position, i.is_checked, i.checked_at, i.due_at
  FROM card_items i
  JOIN cards c ON c.id = i.card_id
  JOIN lists l ON l.id = c.list_id
 WHERE c.board_id = :board_id
   AND c.is_archived = 0
   AND l.is_archived = 0
 ORDER BY i.card_id, i.position, i.id
"""


def build(db: Session, *, board_id: int) -> dict[str, Any]:
    """The `BoardPayload` of Section 4.10.1 for `board_id`.

    Raises `NotFound` when the board does not exist - the same 404 `board_access` raises. A closed
    board returns its payload like any other; the client renders `ClosedBoardPage` from
    `board.is_closed` (Section 2.3.5). Everything returned is a plain dict rather than an ORM
    row, because the caller records the board view afterwards and that write ends the read
    snapshot these rows were loaded in (Section 4.3).
    """
    board = _board(db, board_id)
    labels = list_labels(db, board_id=board_id)
    # `.mappings()` rather than plain rows throughout: a board of 3000 cards reads 24 columns
    # from each of them, and keyed access to a `RowMapping` is several times cheaper than
    # attribute access to a `Row` when SQLAlchemy is installed without its C extensions.
    list_rows = db.execute(text(_LISTS_SQL), {"board_id": board_id}).mappings()
    lists = [_list(row) for row in list_rows]
    # `GROUP_CONCAT` has no defined row order, so `label_ids` is ordered against the array the
    # client already has: no extra statement, and a stable payload.
    label_order = {label["id"]: index for index, label in enumerate(labels)}
    card_rows = db.execute(text(_CARDS_SQL), {"board_id": board_id}).mappings()
    items = _items_by_card(db, board_id)
    cards = [
        _card(row, label_order=label_order, items=items.get(row["id"], [])) for row in card_rows
    ]
    return {
        "board": board_summary(board),
        "labels": labels,
        "lists": lists,
        "cards": cards,
    }


def _board(db: Session, board_id: int) -> Board:
    """Statement 1: the board row itself."""
    board = db.execute(select(Board).where(Board.id == board_id)).scalar_one_or_none()
    if board is None:  # pragma: no cover - board_access resolved this same row a moment ago
        raise NotFound("not_found", "Space not found.")
    return board


def _list(row: Mapping[str, Any]) -> dict[str, Any]:
    """The `ListOut` of Section 4.4. `is_archived` is always false in the payload."""
    return {
        "id": row["id"],
        "board_id": row["board_id"],
        "name": row["name"],
        "position": row["position"],
        "color": row["color"],
        "is_archived": bool(row["is_archived"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _items_by_card(db: Session, board_id: int) -> dict[int, list[dict[str, Any]]]:
    """Statement 5 grouped by `card_id`, each list already in `(position, id)` order.

    The rows arrive sorted by `card_id`, so this is one pass with no sort of its own; a card
    with no items is simply absent and `build` hands it the empty list.
    """
    grouped: dict[int, list[dict[str, Any]]] = {}
    for row in db.execute(text(_ITEMS_SQL), {"board_id": board_id}).mappings():
        grouped.setdefault(row["card_id"], []).append(
            {
                "id": row["id"],
                "card_id": row["card_id"],
                "name": row["name"],
                "position": row["position"],
                "is_checked": bool(row["is_checked"]),
                "checked_at": row["checked_at"],
                "due_at": row["due_at"],
            }
        )
    return grouped


def _card(
    row: Mapping[str, Any],
    *,
    label_order: dict[int, int],
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    """The `CardSummary` of Section 4.5, items and badges and all.

    One dict literal rather than a base dict merged with the rest: on the 3,000-card fixture the
    second dict and the `|=` cost 7 ms of the Section 5.11 budget, and JSON objects have no order
    for `client_id` to be first in.
    """
    card: dict[str, Any] = {
        "id": row["id"],
        "board_id": row["board_id"],
        "list_id": row["list_id"],
        "short_id": row["short_id"],
        "title": row["title"],
        "position": row["position"],
        "is_archived": bool(row["is_archived"]),
        "start_at": row["start_at"],
        "due_at": row["due_at"],
        "due_complete": bool(row["due_complete"]),
        "label_ids": _ordered_ids(row["label_ids"], label_order),
        "items": items,
        "badges": {
            "description": bool(row["has_description"]),
            "item_done": sum(1 for item in items if item["is_checked"]),
            "item_total": len(items),
        },
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
    client_id = row["client_id"]
    if client_id is not None:
        # A stored `client_id` is echoed for the row's lifetime so `CardTile` never remounts;
        # a card that was not created optimistically has none and the field is omitted (4.5).
        card["client_id"] = client_id
    return card


def _ordered_ids(concatenated: str | None, order: dict[int, int]) -> list[int]:
    """Turn one `GROUP_CONCAT` cell into the id array the client expects.

    `order` is the payload's own ordering for those ids - labels by `labels.position` - so the
    array follows the board rather than whatever order SQLite happened to aggregate in. An id the
    board does not list (only reachable if a foreign row survived a cross-board move) sorts last
    instead of being dropped. The two early returns are the shapes almost every card has, and
    they carry most of the board's cards.
    """
    if not concatenated:
        return []
    if "," not in concatenated:
        return [int(concatenated)]
    return sorted(
        (int(value) for value in concatenated.split(",")),
        key=lambda row_id: (order.get(row_id, len(order)), row_id),
    )
