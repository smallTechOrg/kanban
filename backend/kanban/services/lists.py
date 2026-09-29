"""Lists: the column itself, its reorder and the bulk card operations of its menu (Section 4.4).

Every mutation here opens exactly one `write_tx()`, takes its positions from `ordering.py` and
records its activity rows through `activity.record()`. Permission checks are not repeated: by the
time a router calls in, `access.board_access()` has resolved the board
the list belongs to, and the `board_id` each function receives is the one it resolved. Each
mutation re-reads the list under the write lock, because the router's read snapshot is gone by
then and may be stale (Section 6.7.2 step 6).
"""

from collections.abc import Sequence
from typing import Any, Final

from sqlalchemy import case, collate, func, select, update
from sqlalchemy.orm import Session

from kanban import activity, copy, storage
from kanban.db import write_tx
from kanban.errors import BadRequest, Conflict, NotFound
from kanban.models import Card, List
from kanban.ordering import check_neighbours, place_in_container, renumber
from kanban.services.boards import orphaned_upload_ids
from kanban.services.cards import (
    ARCHIVED_PAGE_LIMIT,
    board_name,
    next_short_id,
    reassign_board,
    target_board,
)

#: The four orders "Sort list" offers, mapped to the ORDER BY each one needs (Section 4.4).
#: `due` sorts cards without a due date last; `title` is by card name, case-insensitively.
_SORT_ORDERS: Final[dict[str, tuple[Any, ...]]] = {
    "created_desc": (Card.created_at.desc(), Card.id.desc()),
    "created_asc": (Card.created_at.asc(), Card.id.asc()),
    "title": (collate(Card.title, "NOCASE"), Card.id.asc()),
    "due": (case((Card.due_at.is_(None), 1), else_=0), Card.due_at.asc(), Card.id.asc()),
}


def _list_out(row: List) -> dict[str, Any]:
    """Build the `ListOut` of Section 4.4 from a `lists` row."""
    return {
        "id": row.id,
        "board_id": row.board_id,
        "name": row.name,
        "position": row.position,
        "color": row.color,
        "is_archived": bool(row.is_archived),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _load_list(db: Session, list_id: int) -> dict[str, Any]:
    """Re-read a list after a write so `position` and `updated_at` are the committed ones.

    `expire_on_commit` is off on the session, so the instance left over from the transaction may
    still carry pre-write values; `populate_existing` forces the SELECT.
    """
    row = db.get(List, list_id, populate_existing=True)
    if row is None:  # pragma: no cover - the write committed a moment ago
        raise NotFound("not_found", "That list does not exist.")
    return _list_out(row)


def _locked_list(db: Session, *, list_id: int, board_id: int) -> List:
    """The list, re-read inside the open write transaction. Raises `NotFound` if it moved away."""
    row = db.get(List, list_id, populate_existing=True)
    if row is None or row.board_id != board_id:  # pragma: no cover - lost a race with a deleter
        raise NotFound("not_found", "That list does not exist.")
    return row


def _active_cards(db: Session, list_id: int, *, order_by: Sequence[Any] = ()) -> list[Card]:
    """The list's non-archived cards, in `position` order unless another order is given."""
    ordering = tuple(order_by) or (Card.position, Card.id)
    return list(
        db.execute(
            select(Card)
            .where(Card.list_id == list_id, Card.is_archived == 0)
            .order_by(*ordering)
            .execution_options(populate_existing=True)
        )
        .scalars()
        .all()
    )


def _list_cards(db: Session, list_id: int) -> list[Card]:
    """Every card of a list, archived ones included, in `position` order.

    What a cross-board list move hands over: an archived card still belongs to its column and
    comes back with it when the list is sent to a board (Section 3.7), so it travels with it.
    """
    return list(
        db.execute(
            select(Card)
            .where(Card.list_id == list_id)
            .order_by(Card.position, Card.id)
            .execution_options(populate_existing=True)
        )
        .scalars()
        .all()
    )


def _active_slot_after(db: Session, row: List) -> int:
    """The index directly after `row` among the board's active lists (`/copy`'s default).

    An archived source has no slot of its own, so its copy appends.
    """
    ids = list(
        db.execute(
            select(List.id)
            .where(List.board_id == row.board_id, List.is_archived == 0)
            .order_by(List.position, List.id)
        )
        .scalars()
        .all()
    )
    return ids.index(row.id) + 1 if row.id in ids else len(ids)


def _destination_list(db: Session, *, list_id: int, board_id: int, to_list_id: int) -> List:
    """The target of "Move all cards in this list". Raises `BadRequest` (Section 4.4).

    Same board only, the target must be active, and a list cannot be its own destination.
    """
    if to_list_id == list_id:
        raise BadRequest("bad_request", "Pick a different list to move the cards to.")
    target = db.get(List, to_list_id, populate_existing=True)
    if target is None or target.board_id != board_id or target.is_archived:
        raise BadRequest("bad_request", "That list is not an active list of this board.")
    return target


def list_lists(db: Session, *, board_id: int) -> list[dict[str, Any]]:
    """The board's active lists with their active card counts (Section 4.4).

    One query: the lists left-joined onto their non-archived cards. It is a read, which
    is what the router's read dependency enforces.
    """
    rows = db.execute(
        select(List, func.count(Card.id).label("card_count"))
        .outerjoin(Card, (Card.list_id == List.id) & (Card.is_archived == 0))
        .where(List.board_id == board_id, List.is_archived == 0)
        .group_by(List.id)
        .order_by(List.position, List.id)
    ).all()
    return [_list_out(row.List) | {"card_count": row.card_count} for row in rows]


def create_list(
    db: Session, *, board_id: int, name: str, index: int | None
) -> tuple[dict[str, Any], int]:
    """Add a list to a board; an absent `index` appends (Sections 4.4 and 3.6).

    Activity `list.created`. Raises `Busy` (503) when the write lock is unavailable.
    """
    with write_tx(db, [board_id]) as ctx:
        position, _ = place_in_container(db, List, "board_id", board_id, index=index)
        row = List(board_id=board_id, name=name, position=position)
        db.add(row)
        db.flush()  # the id the activity row references
        activity.record(ctx, "list.created", list_id=row.id, list_name=name)
        list_id = row.id
    return _load_list(db, list_id), ctx.board_version


def update_list(
    db: Session, *, list_id: int, board_id: int, changes: dict[str, Any]
) -> tuple[dict[str, Any], int]:
    """Rename a list or change its colour (Section 4.4).

    `changes` is the `exclude_unset` dump of `ListUpdateIn`; `color: null` removes the colour.
    One activity row per changed field - `list.renamed`, `list.color_changed` - and none for a
    field set to the value it already had. Raises `Busy` (503).
    """
    with write_tx(db, [board_id]) as ctx:
        row = _locked_list(db, list_id=list_id, board_id=board_id)
        if "name" in changes and changes["name"] != row.name:
            activity.record(
                ctx,
                "list.renamed",
                list_id=list_id,
                **{"from": row.name, "to": changes["name"]},
            )
            row.name = changes["name"]
        if "color" in changes and changes["color"] != row.color:
            row.color = changes["color"]
            activity.record(
                ctx,
                "list.color_changed",
                list_id=list_id,
                list_name=row.name,
                color=row.color,
            )
    return _load_list(db, list_id), ctx.board_version


def move_list(
    db: Session,
    *,
    list_id: int,
    board_id: int,
    index: int,
    prev_id: int | None = None,
    next_id: int | None = None,
    to_board_id: int | None = None,
) -> tuple[dict[str, Any], dict[int, float], int]:
    """Reorder a list, or hand it and its cards to another board (Sections 4.4, 4.9 and 3.6).

    The position comes from `ordering.place_in_container` with the list itself excluded, so
    neighbours take precedence over `index` and a renumbered container is reported back in the
    `positions` map. Activity `list.moved`.

    A `to_board_id` that differs from the list's board makes it **one transaction spanning both
    boards** (`write_tx(db, [source, target])`), exactly as the cross-board card move of
    `services.cards.move_card`: every card of the column - archived ones included, because they
    belong to the list and come back with it - goes through `services.cards.reassign_board`, so
    each gets a fresh `short_id` on the target board and loses its labels, which belong to the
    board it left. The rows are `list.moved_out` on the source board with the source's
    version and `list.moved_in` on the target with the target's, both bumped in the same COMMIT, so
    the column can never be missing from both boards. The returned version is the destination's.

    Raises `NotFound` (404) when `to_board_id` names no board, `Conflict` (409) when
    it is closed, `BadRequest` (400) when a neighbour is the list itself or belongs to another
    board, and `Busy` (503).
    """
    crossing = to_board_id is not None and to_board_id != board_id
    destination_board_id = to_board_id if crossing else board_id
    assert destination_board_id is not None  # `crossing` is False when `to_board_id` is None
    # Checked before the transaction opens: `write_tx` reads the version of every board it is
    # given, so a board the caller may not write to must never reach it.
    other_board = target_board(db, board_id=destination_board_id) if crossing else None
    with write_tx(db, [board_id, destination_board_id] if crossing else [board_id]) as ctx:
        row = _locked_list(db, list_id=list_id, board_id=board_id)
        check_neighbours(
            db,
            List,
            "board_id",
            destination_board_id,
            noun="list",
            moved_id=list_id,
            prev_id=prev_id,
            next_id=next_id,
        )
        position, renumbered = place_in_container(
            db,
            List,
            "board_id",
            destination_board_id,
            index=index,
            prev_id=prev_id,
            next_id=next_id,
            exclude_id=list_id,
        )
        row.position = position
        if other_board is None:
            activity.record(
                ctx,
                "list.moved",
                list_id=list_id,
                list_name=row.name,
                index=index,
            )
        else:
            source_name = board_name(db, board_id)
            row.board_id = other_board.id
            for card in _list_cards(db, list_id):
                reassign_board(db, card, to_board_id=other_board.id)
            # `other_board_*` names the board at the *other* end of the move, seen from the board
            # whose feed the row belongs to (Section 3.8), so the two rows mirror each other.
            for type_, feed_board_id, other_id, other_name in (
                ("list.moved_out", board_id, other_board.id, other_board.name),
                ("list.moved_in", other_board.id, board_id, source_name),
            ):
                activity.record(
                    ctx,
                    type_,
                    list_id=list_id,
                    board_id=feed_board_id,
                    list_name=row.name,
                    other_board_id=other_id,
                    other_board_name=other_name,
                    index=index,
                )
    return _load_list(db, list_id), renumbered, ctx.versions[destination_board_id]


def copy_list(
    db: Session, *, list_id: int, board_id: int, name: str, index: int | None
) -> tuple[dict[str, Any], int]:
    """Copy a list and its non-archived cards (Section 4.4).

    An absent `index` puts the copy directly after the source. What a copied card *is* - its
    columns, its labels, its checklists with their items and its attachments with their files -
    belongs to `kanban/copy.py`, which the card copy of Section 4.5 shares (CLAUDE.md section 3);
    this function owns the request: the destination slot, the first of the consecutive `short_id`s
    the copies take and the activity rows. Which cards travel is the rule here: the active ones, so
    an archived card is not silently resurrected as a copy.

    Activity `list.copied`, plus one `card.copied` per copied card. Raises `Busy` (503).
    """
    with write_tx(db, [board_id]) as ctx:
        source = _locked_list(db, list_id=list_id, board_id=board_id)
        slot = _active_slot_after(db, source) if index is None else index
        position, _ = place_in_container(db, List, "board_id", board_id, index=slot)
        cards = _active_cards(db, list_id)
        result = copy.copy_list(
            db,
            source,
            board_id=board_id,
            name=name,
            position=position,
            cards=cards,
            short_id=next_short_id(db, board_id),
        )
        activity.record(
            ctx,
            "list.copied",
            list_id=result.list.id,
            list_name=name,
            source_list_id=list_id,
            source_list_name=source.name,
            card_count=len(cards),
        )
        for copied in result.cards:
            activity.record(
                ctx,
                "card.copied",
                card_id=copied.card.id,
                list_id=result.list.id,
                card_title=copied.card.title,
                source_card_id=copied.source.id,
                source_card_title=copied.source.title,
                source_list_name=source.name,
                list_name=name,
            )
        copy_id = result.list.id
    return _load_list(db, copy_id), ctx.board_version


def archive_list(db: Session, *, list_id: int, board_id: int) -> tuple[dict[str, Any], int]:
    """Archive a list; its cards stay attached and are hidden with it (Sections 3.7 and 6.8).

    `position` is retained, so `unarchive_list` restores the original slot. Activity
    `list.archived`. Raises `Busy` (503).
    """
    return _set_archived(db, list_id=list_id, board_id=board_id, archived=True)


def unarchive_list(db: Session, *, list_id: int, board_id: int) -> tuple[dict[str, Any], int]:
    """Send an archived list back to the board, into its old slot (Sections 3.6 and 4.4).

    The neighbour query of `ordering.place_in_container` counts archived rows, so the retained
    `position` is still a valid slot and nothing is renumbered. Activity `list.unarchived`.
    Raises `Busy` (503).
    """
    return _set_archived(db, list_id=list_id, board_id=board_id, archived=False)


def _set_archived(
    db: Session, *, list_id: int, board_id: int, archived: bool
) -> tuple[dict[str, Any], int]:
    """The one write behind `/archive` and `/unarchive`: flip the flag, record the activity."""
    with write_tx(db, [board_id]) as ctx:
        row = _locked_list(db, list_id=list_id, board_id=board_id)
        row.is_archived = int(archived)
        activity.record(
            ctx,
            "list.archived" if archived else "list.unarchived",
            list_id=list_id,
            list_name=row.name,
        )
    return _load_list(db, list_id), ctx.board_version


def delete_list(db: Session, *, list_id: int, board_id: int) -> None:
    """Hard-delete an archived list and cascade its cards (Sections 3.7 and 6.8).

    Raises `Conflict` (409) unless the list is archived, which is the whole state machine:
    archive first, then delete. No activity row is recorded - Section 3.8 has no `list.deleted`
    type, and the rows that reference the list keep their history through
    `activities.list_id ON DELETE SET NULL`. Every attachment directory of the cards this cascade
    removes is deleted after the commit (Section 3.7). Raises `Busy` (503).
    """
    with write_tx(db, [board_id]):
        row = _locked_list(db, list_id=list_id, board_id=board_id)
        if not row.is_archived:
            raise Conflict("conflict", "Archive the list before deleting it.", {"list_id": list_id})
        doomed = orphaned_upload_ids(db, Card.list_id == list_id)
        db.delete(row)
    storage.delete_uploads(doomed)


def move_all_cards(
    db: Session, *, list_id: int, board_id: int, to_list_id: int
) -> tuple[int, dict[int, float], int]:
    """Move every active card of a list to another list of the same board (Section 4.4).

    The cards are appended in their current order and the destination's active cards are
    renumbered `STEP, 2*STEP, ...` in one pass, so the returned `positions` map covers every card
    of the destination. One `card.moved` activity per card. Raises `BadRequest` (400) when the
    destination is not an active list of this board, and `Busy` (503).
    """
    with write_tx(db, [board_id]) as ctx:
        source = _locked_list(db, list_id=list_id, board_id=board_id)
        target = _destination_list(db, list_id=list_id, board_id=board_id, to_list_id=to_list_id)
        moving = _active_cards(db, list_id)
        settled = _active_cards(db, to_list_id)
        positions = renumber(db, Card, [card.id for card in settled + moving])
        if moving:
            db.execute(
                update(Card)
                .where(Card.id.in_([card.id for card in moving]))
                .values(list_id=to_list_id)
            )
        for offset, card in enumerate(moving):
            activity.record(
                ctx,
                "card.moved",
                card_id=card.id,
                list_id=to_list_id,
                card_title=card.title,
                from_list_id=list_id,
                from_list_name=source.name,
                to_list_id=to_list_id,
                to_list_name=target.name,
                index=len(settled) + offset,
            )
    return len(moving), positions, ctx.board_version


def archive_all_cards(db: Session, *, list_id: int, board_id: int) -> tuple[list[int], int]:
    """Archive every active card of a list in one transaction (Section 4.4).

    Returns the archived ids in `position` order, which the Undo toast hands straight back to
    `unarchive_cards`. One `card.archived` activity per card, one version bump. Raises `Busy`.
    """
    with write_tx(db, [board_id]) as ctx:
        _locked_list(db, list_id=list_id, board_id=board_id)
        cards = _active_cards(db, list_id)
        for card in cards:
            card.is_archived = 1
            activity.record(
                ctx,
                "card.archived",
                card_id=card.id,
                list_id=list_id,
                card_title=card.title,
            )
        archived_ids = [card.id for card in cards]
    return archived_ids, ctx.board_version


def unarchive_cards(
    db: Session, *, list_id: int, board_id: int, card_ids: Sequence[int]
) -> tuple[int, int]:
    """Undo "Archive all cards": restore the listed cards of this list (Section 4.4).

    Each card keeps its stored `position`, so they reappear where they were. Ids that are not
    archived cards of this list are ignored and counted out of the result; raises `BadRequest`
    (400) when any id belongs to another board, and `Busy` (503). One `card.unarchived` activity
    per restored card, one version bump.
    """
    foreign = db.execute(
        select(Card.id).where(Card.id.in_(card_ids), Card.board_id != board_id)
    ).first()
    if foreign is not None:
        raise BadRequest("bad_request", "Those cards are not on this board.")
    with write_tx(db, [board_id]) as ctx:
        _locked_list(db, list_id=list_id, board_id=board_id)
        cards = (
            db.execute(
                select(Card)
                .where(Card.id.in_(card_ids), Card.list_id == list_id, Card.is_archived == 1)
                .order_by(Card.position, Card.id)
                .execution_options(populate_existing=True)
            )
            .scalars()
            .all()
        )
        for card in cards:
            card.is_archived = 0
            activity.record(
                ctx,
                "card.unarchived",
                card_id=card.id,
                list_id=list_id,
                card_title=card.title,
            )
        restored = len(cards)
    return restored, ctx.board_version


def sort_list(db: Session, *, list_id: int, board_id: int, by: str) -> tuple[dict[int, float], int]:
    """Sort a list's active cards and renumber them `STEP, 2*STEP, ...` (Sections 4.4 and 3.6).

    `by` is one of `created_desc`, `created_asc`, `title` (card name) or `due`, which sorts cards
    without a due date last. The whole list is rewritten in one pass and the new `positions` map
    is returned. One `card.reordered` activity per card - the same-list move type, which the
    feeds do not render (Section 3.8). Raises `Busy` (503).
    """
    with write_tx(db, [board_id]) as ctx:
        row = _locked_list(db, list_id=list_id, board_id=board_id)
        cards = _active_cards(db, list_id, order_by=_SORT_ORDERS[by])
        positions = renumber(db, Card, [card.id for card in cards])
        for index, card in enumerate(cards):
            activity.record(
                ctx,
                "card.reordered",
                card_id=card.id,
                list_id=list_id,
                card_title=card.title,
                list_name=row.name,
                index=index,
            )
    return positions, ctx.board_version


def list_archived_lists(
    db: Session,
    *,
    board_id: int,
    q: str | None = None,
    before: int | None = None,
    limit: int = ARCHIVED_PAGE_LIMIT,
) -> tuple[list[dict[str, Any]], int | None]:
    """One page of the board's archived lists, newest first (Section 4.3).

    The `type=lists` half of the Archived Items panel, shaped like every other list response so
    "Send to board" can patch the row straight into the board cache. `q` is a case-insensitive
    substring of the name, `before` is an `id` cursor, and the second element of the result is the
    `next_before` the panel pages with - the last row's id when the page was full, `None` when it
    was the last page. The archived cards of the same panel come from
    `services.cards.list_archived_cards`, because each aggregate owns the shape it is read in.
    """
    statement = select(List).where(List.board_id == board_id, List.is_archived == 1)
    if q:
        statement = statement.where(collate(List.name, "NOCASE").contains(q, autoescape=True))
    if before is not None:
        statement = statement.where(List.id < before)
    rows = list(
        db.execute(
            statement.order_by(List.id.desc())
            .limit(limit)
            .execution_options(populate_existing=True)
        )
        .scalars()
        .all()
    )
    return [_list_out(row) for row in rows], rows[-1].id if len(rows) == limit else None
