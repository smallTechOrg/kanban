"""Checklists and their items: the modal's `ChecklistSection` (Sections 4.6, 2.6.3 and 3.6).

Every mutation here opens exactly one `write_tx()`, records its `activities` rows through
`activity.record()` and takes every `position` from `ordering.place_in_container()` - never from
midpoint maths of its own (CLAUDE.md section 3). Permission checks are not repeated: by the time
a router calls in, `access.board_access` has resolved the board the checklist
belongs to, and the `board_id` each function receives is the one it resolved.

`checklists` and `checklist_items` carry no `is_archived`, so `place_in_container`'s `literal(0)`
fallback counts every sibling as active (Section 3.6) and an `index` is a slot over all of them.

One deliberate placement, for the reason `services/lists.py` keeps `list_lists()` (CLAUDE.md
section 8): `list_board_checklists()` backs `GET /api/boards/{board_id}/checklists`, which
Section 6.7 tables under `services/boards.py`. It is a rule of the checklist aggregate, its only
caller is `routers/checklists.py`, and putting it in `services/boards.py` would make that module
import the checklist models and this module's row shape for one read-only endpoint.

The row shapes this module answers with - `ChecklistOut` and `ChecklistItemOut` - are built by
`services.cards`, which embeds the very same objects in the `CardDetail` of Section 4.5; see the
note at the top of that module.
"""

from collections.abc import Sequence
from typing import Any, NamedTuple

from sqlalchemy import collate, func, select
from sqlalchemy.orm import Session

from kanban import activity
from kanban.db import write_tx
from kanban.errors import BadRequest, NotFound
from kanban.models import Card, Checklist, ChecklistItem, List, utcnow_iso
from kanban.ordering import check_neighbours, place_in_container
from kanban.services.cards import (
    card_badges,
    card_summary,
    checklist_item_out,
    checklist_items,
    checklist_out,
    next_short_id,
    split_pasted_lines,
)


class Mutation(NamedTuple):
    """What a single-row mutation returns: the row plus the version it produced (Section 4.1)."""

    item: dict[str, Any]
    board_version: int


class Batch(NamedTuple):
    """What `create_items` returns: one item normally, one per pasted line with `split_lines`."""

    items: list[dict[str, Any]]
    board_version: int


class Move(NamedTuple):
    """What a move returns: the `MoveResult` of Section 4.9.

    `positions` is empty unless the destination had to be renumbered; when it is not, it maps
    every *other* row the renumber rewrote to its new position.
    """

    item: dict[str, Any]
    positions: dict[int, float]
    board_version: int


# --------------------------------------------------------------------------- reading rows


def _load_checklist(db: Session, checklist_id: int) -> Checklist:
    """Re-read a checklist from the database, never from the identity map.

    `expire_on_commit` is off on the session (Section 6.5.2), so an instance left over from a
    transaction still carries pre-commit values; `populate_existing` forces the SELECT. Inside a
    `write_tx` this is also the re-read under the write lock of Section 6.7.2 step 6.
    """
    row = db.get(Checklist, checklist_id, populate_existing=True)
    if row is None:  # pragma: no cover - the router's dependency resolved it a moment ago
        raise NotFound("not_found", "That checklist does not exist.")
    return row


def _load_item(db: Session, item_id: int) -> ChecklistItem:
    """Re-read one checklist item. Raises `NotFound` when it is gone (same rule as above)."""
    row = db.get(ChecklistItem, item_id, populate_existing=True)
    if row is None:  # pragma: no cover - the router's dependency resolved it a moment ago
        raise NotFound("not_found", "That checklist item does not exist.")
    return row


def _load_card(db: Session, card_id: int) -> Card:
    """The card a checklist hangs off, re-read under the lock for its title and list."""
    card = db.get(Card, card_id, populate_existing=True)
    if card is None:  # pragma: no cover - ON DELETE CASCADE removes the checklist with the card
        raise NotFound("not_found", "That card does not exist.")
    return card


def list_board_checklists(db: Session, *, board_id: int) -> list[dict[str, Any]]:
    """Every checklist of the board whose card is visible, for "Copy items from…" (Section 4.6).

    Archived cards and the cards of archived lists are excluded, the visibility rule the board
    payload applies (Section 4.3). Ordered by card title - case-insensitively, as "Sort list"
    orders by title - then by checklist `position`. It is a read, which is what the
    router's read dependency enforces.
    """
    rows = db.execute(
        select(
            Checklist.id,
            Checklist.name,
            Checklist.card_id,
            Card.title.label("card_title"),
            func.count(ChecklistItem.id).label("item_count"),
        )
        .join(Card, Card.id == Checklist.card_id)
        .join(List, List.id == Card.list_id)
        .outerjoin(ChecklistItem, ChecklistItem.checklist_id == Checklist.id)
        .where(Card.board_id == board_id, Card.is_archived == 0, List.is_archived == 0)
        .group_by(Checklist.id)
        .order_by(collate(Card.title, "NOCASE"), Checklist.position, Checklist.id)
    ).all()
    return [
        {
            "id": row.id,
            "name": row.name,
            "card_id": row.card_id,
            "card_title": row.card_title,
            "item_count": row.item_count,
        }
        for row in rows
    ]


# --------------------------------------------------------------------------- checklists


def _copy_source(db: Session, *, checklist_id: int, board_id: int) -> Checklist:
    """The checklist "Copy items from…" points at, verified under the write lock (Section 4.6).

    Raises `BadRequest` (400) - never `NotFound` - when it does not exist or its card belongs to
    another board, because `copy_from_checklist_id` is a body field, not the addressed row.
    """
    row = db.get(Checklist, checklist_id, populate_existing=True)
    if row is None or _load_card(db, row.card_id).board_id != board_id:
        raise BadRequest(
            "bad_request",
            "That checklist is not on this board.",
            {"checklist_id": checklist_id, "board_id": board_id},
        )
    return row


def create_checklist(
    db: Session,
    *,
    board_id: int,
    card_id: int,
    name: str,
    copy_from_checklist_id: int | None = None,
) -> Mutation:
    """Add a checklist to a card, optionally copying another one's items (Section 4.6).

    Copied items arrive unchecked and unassigned with no due date, in the source's order and
    freshly spaced by `ordering.place_in_container` - Trello's "Copy items from…" carries the
    text only. The whole create is one user action, so it records one `checklist.added` row and
    none per copied item. Raises `BadRequest` (400) when the source checklist is not on this
    board and `Busy` (503) when the write lock cannot be taken.
    """
    with write_tx(db, [board_id]) as ctx:
        card = _load_card(db, card_id)
        source_items: Sequence[ChecklistItem] = ()
        if copy_from_checklist_id is not None:
            source = _copy_source(db, checklist_id=copy_from_checklist_id, board_id=board_id)
            source_items = checklist_items(db, source.id)
        position, _ = place_in_container(db, Checklist, "card_id", card_id)
        row = Checklist(card_id=card_id, name=name, position=position)
        db.add(row)
        db.flush()  # the id the items and the activity row reference
        for item in source_items:
            # No index: each copy appends after the previous one, so the source order survives.
            item_position, _ = place_in_container(db, ChecklistItem, "checklist_id", row.id)
            db.add(ChecklistItem(checklist_id=row.id, name=item.name, position=item_position))
            db.flush()  # autoflush is off, so the next placement must see this row
        activity.record(
            ctx,
            "checklist.added",
            card_id=card_id,
            list_id=card.list_id,
            card_title=card.title,
            checklist_id=row.id,
            checklist_name=name,
        )
        checklist_id = row.id
    return Mutation(
        item=checklist_out(db, _load_checklist(db, checklist_id)),
        board_version=ctx.board_version,
    )


def rename_checklist(
    db: Session, *, board_id: int, checklist_id: int, changes: dict[str, Any]
) -> Mutation:
    """Rename a checklist from its section header (Section 4.6).

    `changes` is the `exclude_unset` dump of `ChecklistUpdateIn`; a name equal to the stored one
    records nothing. Activity `checklist.renamed`. Raises `Busy` (503).
    """
    with write_tx(db, [board_id]) as ctx:
        row = _load_checklist(db, checklist_id)
        card = _load_card(db, row.card_id)
        name = changes.get("name")
        if name is not None and name != row.name:
            activity.record(
                ctx,
                "checklist.renamed",
                card_id=card.id,
                list_id=card.list_id,
                card_title=card.title,
                checklist_id=checklist_id,
                checklist_name=name,
                **{"from": row.name},
            )
            row.name = name
    return Mutation(
        item=checklist_out(db, _load_checklist(db, checklist_id)),
        board_version=ctx.board_version,
    )


def delete_checklist(db: Session, *, board_id: int, checklist_id: int) -> None:
    """Delete a checklist and its items (Section 4.6): checklists have no archive state.

    The items go with it through `checklist_items.checklist_id ON DELETE CASCADE`. Activity
    `checklist.deleted`. Raises `Busy` (503).
    """
    with write_tx(db, [board_id]) as ctx:
        row = _load_checklist(db, checklist_id)
        card = _load_card(db, row.card_id)
        activity.record(
            ctx,
            "checklist.deleted",
            card_id=card.id,
            list_id=card.list_id,
            card_title=card.title,
            checklist_id=checklist_id,
            checklist_name=row.name,
        )
        db.delete(row)


def move_checklist(
    db: Session,
    *,
    board_id: int,
    checklist_id: int,
    index: int,
    prev_id: int | None = None,
    next_id: int | None = None,
) -> Move:
    """Reorder a checklist within its card (Sections 4.6, 4.9 and 3.6).

    The target of the modal's `CHECKLIST` drag, whose handle is the section header. The position
    comes from `ordering.place_in_container` with the checklist itself excluded, so neighbours
    take precedence over `index` and a renumbered card is reported back in `positions`. Activity
    `checklist.moved` (SSE only, not shown in the feed). Raises `BadRequest` (400) when a
    neighbour is the checklist itself or belongs to another card, and `Busy` (503).
    """
    with write_tx(db, [board_id]) as ctx:
        row = _load_checklist(db, checklist_id)
        card = _load_card(db, row.card_id)
        check_neighbours(
            db,
            Checklist,
            "card_id",
            card.id,
            noun="checklist",
            moved_id=checklist_id,
            prev_id=prev_id,
            next_id=next_id,
        )
        position, renumbered = place_in_container(
            db,
            Checklist,
            "card_id",
            card.id,
            index=index,
            prev_id=prev_id,
            next_id=next_id,
            exclude_id=checklist_id,
        )
        row.position = position
        activity.record(
            ctx,
            "checklist.moved",
            card_id=card.id,
            list_id=card.list_id,
            card_title=card.title,
            checklist_id=checklist_id,
            checklist_name=row.name,
            index=index,
        )
    return Move(
        item=checklist_out(db, _load_checklist(db, checklist_id)),
        positions=renumbered,
        board_version=ctx.board_version,
    )


# --------------------------------------------------------------------------- items


def create_items(
    db: Session,
    *,
    board_id: int,
    checklist_id: int,
    name: str,
    index: int | None = None,
    split_lines: bool = False,
) -> Batch:
    """Add an item to a checklist, or one per pasted line with `split_lines` (Section 4.6).

    An absent `index` appends; an explicit one walks forward a slot per line so the pasted order
    survives. One `checklist.item_added` row per item, all in one transaction and therefore one
    version bump. Raises `Busy` (503) when the write lock cannot be taken.
    """
    names = split_pasted_lines(name, split_lines=split_lines)
    with write_tx(db, [board_id]) as ctx:
        checklist = _load_checklist(db, checklist_id)
        card = _load_card(db, checklist.card_id)
        created: list[int] = []
        for offset, line in enumerate(names):
            # A renumber here is not reported: the create response is `Mutated`, which carries no
            # `positions` map (Section 4.6), and the client's next card read repairs the order.
            position, _ = place_in_container(
                db,
                ChecklistItem,
                "checklist_id",
                checklist_id,
                index=None if index is None else index + offset,
            )
            item = ChecklistItem(checklist_id=checklist_id, name=line, position=position)
            db.add(item)
            db.flush()  # the id the activity row needs; autoflush is off (Section 6.5.2)
            activity.record(
                ctx,
                "checklist.item_added",
                card_id=card.id,
                list_id=card.list_id,
                card_title=card.title,
                checklist_name=checklist.name,
                item_id=item.id,
                item_name=line,
            )
            created.append(item.id)
    return Batch(
        items=[checklist_item_out(_load_item(db, item_id)) for item_id in created],
        board_version=ctx.board_version,
    )


def update_item(db: Session, *, board_id: int, item_id: int, changes: dict[str, Any]) -> Mutation:
    """Patch one checklist item, one activity row per changed field (Sections 4.6 and 3.8).

    `changes` is the `exclude_unset` dump of `ItemUpdateIn`, so `due_at: None` removes the due
    date; a value equal to the stored one records nothing.
    Ticking stamps `checked_at` and clearing it nulls it again. The returned item carries the
    card's recomputed `badges`, so the tile's `checklist_done / checklist_total` is patched from
    this one round trip. Raises `Busy` (503).
    """
    with write_tx(db, [board_id]) as ctx:
        item = _load_item(db, item_id)
        checklist = _load_checklist(db, item.checklist_id)
        card = _load_card(db, checklist.card_id)

        def record(type: str, **data: Any) -> None:
            """One row for one changed field, with the names Section 3.8 denormalises."""
            activity.record(
                ctx,
                type,
                card_id=card.id,
                list_id=card.list_id,
                card_title=card.title,
                checklist_name=checklist.name,
                item_id=item_id,
                **data,
            )

        name = changes.get("name")
        if name is not None and name != item.name:
            record("checklist.item_renamed", item_name=name, **{"from": item.name})
            item.name = name
        is_checked = changes.get("is_checked")
        if is_checked is not None and is_checked != bool(item.is_checked):
            item.is_checked = int(is_checked)
            item.checked_at = utcnow_iso() if is_checked else None
            record(
                "checklist.item_checked" if is_checked else "checklist.item_unchecked",
                item_name=item.name,
            )
        if "due_at" in changes and changes["due_at"] != item.due_at:
            item.due_at = changes["due_at"]
            if item.due_at is None:
                record("checklist.item_due_removed", item_name=item.name)
            else:
                record("checklist.item_due_set", item_name=item.name, due_at=item.due_at)
        card_id = card.id
    return Mutation(
        item=checklist_item_out(_load_item(db, item_id))
        | {"badges": card_badges(db, card_id=card_id)},
        board_version=ctx.board_version,
    )


def delete_item(db: Session, *, board_id: int, item_id: int) -> None:
    """Delete one checklist item (Section 4.6). Activity `checklist.item_deleted`."""
    with write_tx(db, [board_id]) as ctx:
        item = _load_item(db, item_id)
        checklist = _load_checklist(db, item.checklist_id)
        card = _load_card(db, checklist.card_id)
        activity.record(
            ctx,
            "checklist.item_deleted",
            card_id=card.id,
            list_id=card.list_id,
            card_title=card.title,
            checklist_name=checklist.name,
            item_id=item_id,
            item_name=item.name,
        )
        db.delete(item)


def _move_destination(db: Session, *, to_checklist_id: int, card_id: int) -> Checklist:
    """The destination checklist of an item move, verified under the write lock (Section 4.6).

    Raises `BadRequest` (400) - never `NotFound` - when it does not exist or hangs off another
    card, because `to_checklist_id` is a body field, not the addressed row. Items only ever move
    within and across the checklists of one card (Sections 3.6 and 2.6.3).
    """
    target = db.get(Checklist, to_checklist_id, populate_existing=True)
    if target is None or target.card_id != card_id:
        raise BadRequest(
            "bad_request",
            "That checklist is not on this card.",
            {"checklist_id": to_checklist_id, "card_id": card_id},
        )
    return target


def move_item(
    db: Session,
    *,
    board_id: int,
    item_id: int,
    to_checklist_id: int,
    index: int,
    prev_id: int | None = None,
    next_id: int | None = None,
) -> Move:
    """Move an item within or across the checklists of its card (Sections 4.6, 4.9 and 3.6).

    One `UPDATE checklist_items SET checklist_id = ?, position = ?` from a position
    `ordering.place_in_container` computes with the item itself excluded. Activity
    `checklist.item_moved` (SSE only, not shown in the feed). Raises `BadRequest` (400) when
    `to_checklist_id` is on another card or a neighbour breaks the invariant of
    `ordering.check_neighbours`, and `Busy` (503).
    """
    with write_tx(db, [board_id]) as ctx:
        item = _load_item(db, item_id)
        source = _load_checklist(db, item.checklist_id)
        card = _load_card(db, source.card_id)
        target = _move_destination(db, to_checklist_id=to_checklist_id, card_id=card.id)
        check_neighbours(
            db,
            ChecklistItem,
            "checklist_id",
            target.id,
            noun="item",
            moved_id=item_id,
            prev_id=prev_id,
            next_id=next_id,
        )
        position, renumbered = place_in_container(
            db,
            ChecklistItem,
            "checklist_id",
            target.id,
            index=index,
            prev_id=prev_id,
            next_id=next_id,
            exclude_id=item_id,
        )
        activity.record(
            ctx,
            "checklist.item_moved",
            card_id=card.id,
            list_id=card.list_id,
            card_title=card.title,
            checklist_id=source.id,
            checklist_name=source.name,
            item_id=item_id,
            item_name=item.name,
            to_checklist_id=target.id,
            index=index,
        )
        item.checklist_id = target.id
        item.position = position
    return Move(
        item=checklist_item_out(_load_item(db, item_id)),
        positions=renumbered,
        board_version=ctx.board_version,
    )


def convert_item_to_card(
    db: Session, *, board_id: int, item_id: int, index: int | str | None = None
) -> Mutation:
    """Convert an item to a card in its own list and delete the item (Section 4.6).

    The new card is titled with the item's text and numbered with `MAX(short_id) + 1` of the
    board, read under the write lock by the one helper that owns that sequence. `index` is a slot
    over the list's active cards; `"bottom"` and an absent value append. One
    `checklist.item_converted` row carries the deleted `item_id` and the `new_card_id`, which is
    what the feed sentence and the Section 4.8 event mapping need. Raises `Busy` (503).
    """
    with write_tx(db, [board_id]) as ctx:
        item = _load_item(db, item_id)
        checklist = _load_checklist(db, item.checklist_id)
        source = _load_card(db, checklist.card_id)
        position, _ = place_in_container(
            db,
            Card,
            "list_id",
            source.list_id,
            index=index if isinstance(index, int) else None,
        )
        card = Card(
            board_id=board_id,
            list_id=source.list_id,
            short_id=next_short_id(db, board_id),
            title=item.name,
            position=position,
        )
        db.add(card)
        db.flush()  # the id the activity row references
        activity.record(
            ctx,
            "checklist.item_converted",
            card_id=source.id,
            list_id=source.list_id,
            card_title=source.title,
            checklist_name=checklist.name,
            item_id=item_id,
            item_name=item.name,
            new_card_id=card.id,
        )
        db.delete(item)
        card_id = card.id
    return Mutation(item=card_summary(db, card_id=card_id), board_version=ctx.board_version)
