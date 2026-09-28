"""The single round-trip board document (Sections 4.3, 4.10.1 and 6.7).

`GET /api/boards/{board_id}` is the only read the board page makes, so the whole `BoardPayload`
is assembled here in exactly **five statements**, whatever the board holds: board + membership,
members, labels, the active lists, and one cards query whose badge counts, `label_ids`,
`member_ids` and `is_watching` all come from correlated sub-selects. Nothing in this module
iterates a query, so 30 lists x 100 cards costs the same five round trips as an empty board
(Section 4.10.1: under 100 ms for that board).

Raw SQL lives here by design (CLAUDE.md section 2). The cards statement is the one place the
badge aggregates are written down, and an ORM expression of it would either fan every card out
across its labels and members or fall back to a query per card.

Only *active* rows reach the client: the lists statement filters `is_archived = 0` and the cards
statement joins `lists` to filter `lists.is_archived = 0 AND cards.is_archived = 0`, so a card
inside an archived list is absent from the payload and comes back with the list when it is sent
to the board (Sections 3.7 and 4.3).

The row shapes are the `BoardSummary`, `MemberOut` and `LabelOut` of Section 4.3, the `ListOut`
of Section 4.4 and the `CardSummary` of Section 4.5. The three that `services/boards.py` already
builds are reused from there rather than restated.
"""

from collections.abc import Mapping
from typing import Any, Final

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from kanban.errors import NotFound
from kanban.models import Board, BoardMember, BoardStar, User
from kanban.services.boards import UPLOADS_URL, board_summary, list_labels, list_members

#: Statement 4: the board's active lists in `position` order (Section 4.4).
_LISTS_SQL: Final[str] = """
SELECT id, board_id, name, position, color, is_archived, created_at, updated_at
  FROM lists
 WHERE board_id = :board_id
   AND is_archived = 0
 ORDER BY position, id
"""

#: Statement 5: every active card of every active list, with its badges (Section 4.10.1).
#:
#: `description` is Markdown and only its emptiness is a badge, so the body never leaves the
#: database here; the card modal fetches it. The `attachments` LEFT JOIN resolves an
#: `attachment` cover's thumbnail and dominant colour in the same statement and matches nothing for
#: the colour covers and the uncovered cards - the same two columns `services.cards._cover` reads
#: for a single row, which is why a cover mutation's `Mutated[CardSummary]` and this payload agree.
_CARDS_SQL: Final[str] = """
SELECT c.id,
       c.client_id,
       c.board_id,
       c.list_id,
       c.short_id,
       c.title,
       c.position,
       c.is_archived,
       c.is_template,
       c.start_at,
       c.due_at,
       c.due_complete,
       c.cover_type,
       c.cover_value,
       c.cover_size,
       c.created_at,
       c.updated_at,
       c.description <> '' AS has_description,
       (SELECT COUNT(*) FROM comments cm WHERE cm.card_id = c.id) AS comment_count,
       (SELECT COUNT(*) FROM attachments a WHERE a.card_id = c.id) AS attachment_count,
       (SELECT COUNT(*)
          FROM checklist_items ci
          JOIN checklists ch ON ch.id = ci.checklist_id
         WHERE ch.card_id = c.id) AS checklist_total,
       (SELECT COUNT(*)
          FROM checklist_items ci
          JOIN checklists ch ON ch.id = ci.checklist_id
         WHERE ch.card_id = c.id AND ci.is_checked = 1) AS checklist_done,
       (SELECT GROUP_CONCAT(cl.label_id) FROM card_labels cl WHERE cl.card_id = c.id) AS label_ids,
       (SELECT GROUP_CONCAT(cmb.user_id) FROM card_members cmb WHERE cmb.card_id = c.id)
           AS member_ids,
       EXISTS (SELECT 1
                 FROM card_watchers cw
                WHERE cw.card_id = c.id AND cw.user_id = :user_id) AS is_watching,
       cover.thumb_path AS cover_thumb_path,
       cover.dominant_color AS cover_dominant_color
  FROM cards c
  JOIN lists l ON l.id = c.list_id
  LEFT JOIN attachments cover
         ON c.cover_type = 'attachment' AND cover.id = CAST(c.cover_value AS INTEGER)
 WHERE c.board_id = :board_id
   AND c.is_archived = 0
   AND l.is_archived = 0
 ORDER BY c.position, c.id
"""


def build(db: Session, user: User, *, board_id: int) -> dict[str, Any]:
    """The `BoardPayload` of Section 4.10.1 for `board_id`, as `user` sees it.

    Raises `NotFound` when the board does not exist or `user` is not a member - the same 404
    `board_access` raises, so a board id cannot be enumerated through this path either. A closed
    board returns its payload like any other; the client renders `ClosedBoardPage` from
    `board.is_closed` (Section 2.3.5). Everything returned is a plain dict rather than an ORM
    row, because the caller records the board view afterwards and that write ends the read
    snapshot these rows were loaded in (Section 4.3).
    """
    board, my_role, is_starred = _board(db, board_id, user_id=user.id)
    members = list_members(db, board_id=board_id)
    labels = list_labels(db, board_id=board_id)
    # `.mappings()` rather than plain rows throughout: a board of 3000 cards reads 27 columns
    # from each of them, and keyed access to a `RowMapping` is several times cheaper than
    # attribute access to a `Row` when SQLAlchemy is installed without its C extensions.
    list_rows = db.execute(text(_LISTS_SQL), {"board_id": board_id}).mappings()
    lists = [_list(row) for row in list_rows]
    # `GROUP_CONCAT` has no defined row order, so the two id arrays are ordered against the
    # arrays the client already has: no extra statement, and a stable payload.
    label_order = {label["id"]: index for index, label in enumerate(labels)}
    member_order = {member["id"]: index for index, member in enumerate(members)}
    card_rows = db.execute(text(_CARDS_SQL), {"board_id": board_id, "user_id": user.id}).mappings()
    cards = [_card(row, label_order=label_order, member_order=member_order) for row in card_rows]
    return {
        "board": board_summary(board, my_role=my_role, is_starred=is_starred),
        "members": members,
        "labels": labels,
        "lists": lists,
        "cards": cards,
    }


def _board(db: Session, board_id: int, *, user_id: int) -> tuple[Board, str, bool]:
    """Statement 1: the board, the caller's role on it and whether they starred it."""
    row = db.execute(
        select(Board, BoardMember.role, BoardStar.id.label("star_id"))
        .join(BoardMember, (BoardMember.board_id == Board.id) & (BoardMember.user_id == user_id))
        .outerjoin(BoardStar, (BoardStar.board_id == Board.id) & (BoardStar.user_id == user_id))
        .where(Board.id == board_id)
    ).first()
    if row is None:  # pragma: no cover - board_access resolved this same row a moment ago
        raise NotFound("not_found", "Board not found.")
    return row.Board, row.role, row.star_id is not None


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


def _card(
    row: Mapping[str, Any], *, label_order: dict[int, int], member_order: dict[int, int]
) -> dict[str, Any]:
    """The `CardSummary` of Section 4.5, badges and all.

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
        "is_template": bool(row["is_template"]),
        "start_at": row["start_at"],
        "due_at": row["due_at"],
        "due_complete": bool(row["due_complete"]),
        "cover": _cover(row),
        "label_ids": _ordered_ids(row["label_ids"], label_order),
        "member_ids": _ordered_ids(row["member_ids"], member_order),
        "is_watching": bool(row["is_watching"]),
        "badges": {
            "description": bool(row["has_description"]),
            "comments": row["comment_count"],
            "attachments": row["attachment_count"],
            "checklist_done": row["checklist_done"],
            "checklist_total": row["checklist_total"],
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


def _cover(row: Mapping[str, Any]) -> dict[str, Any] | None:
    """The card's cover, `None` when it has none (Sections 2.5.1 and 4.5).

    A `color` cover carries a palette key; an `attachment` cover carries the attachment id as
    text plus the 2:1 thumbnail and the dominant colour Pillow computed for it, which the tile
    shows behind a `contain`-fitted image.
    """
    if row["cover_type"] is None:
        return None
    cover: dict[str, Any] = {
        "kind": row["cover_type"],
        "value": row["cover_value"],
        "size": row["cover_size"],
    }
    if row["cover_thumb_path"] is not None:
        cover["image_url"] = f"{UPLOADS_URL}/{row['cover_thumb_path']}"
    if row["cover_dominant_color"] is not None:
        cover["dominant_color"] = row["cover_dominant_color"]
    return cover


def _ordered_ids(concatenated: str | None, order: dict[int, int]) -> list[int]:
    """Turn one `GROUP_CONCAT` cell into the id array the client expects.

    `order` is the payload's own ordering for that kind of id - labels by `labels.position`,
    members as `MemberOut[]` lists them - so the arrays follow the board rather than whatever
    order SQLite happened to aggregate in. An id the board does not list (only reachable if a
    foreign row survived a cross-board move) sorts last instead of being dropped. The two early
    returns are the shapes almost every card has, and they carry most of the board's cards.
    """
    if not concatenated:
        return []
    if "," not in concatenated:
        return [int(concatenated)]
    return sorted(
        (int(value) for value in concatenated.split(",")),
        key=lambda row_id: (order.get(row_id, len(order)), row_id),
    )
