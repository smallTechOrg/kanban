"""A card's items: the modal's `ItemsSection` (Sections 4.6, 2.6.3 and 3.6).

Every mutation here opens exactly one `write_tx()`, records its `activities` rows through
`activity.record()` and takes every `position` from `ordering.place_in_container()` - never from
midpoint maths of its own (CLAUDE.md section 3). Permission checks are not repeated: by the time a
router calls in, `access.board_access` has resolved the board the item belongs to, and the
`board_id` each function receives is the one it resolved.

The container is the card itself. There is no named checklist to create first, to rename, to
delete or to move an item between, so "add an item" is the whole gesture and a move is a reorder
inside one card.

`card_items` carries no `is_archived`, so `place_in_container`'s `literal(0)` fallback counts every
sibling as active (Section 3.6) and an `index` is a slot over all of them.

The row shape this module answers with - `CardItemOut` - is built by `services.cards`, which
embeds the very same objects in the `CardDetail` of Section 4.5; see the note at the top of that
module.
"""

from typing import Any, NamedTuple

from sqlalchemy.orm import Session

from kanban import activity
from kanban.db import write_tx
from kanban.errors import NotFound
from kanban.models import Card, CardItem, utcnow_iso
from kanban.ordering import check_neighbours, place_in_container
from kanban.services.cards import card_badges, card_item_out, split_pasted_lines


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

    `positions` is empty unless the card had to be renumbered; when it is not, it maps every
    *other* row the renumber rewrote to its new position.
    """

    item: dict[str, Any]
    positions: dict[int, float]
    board_version: int


# --------------------------------------------------------------------------- reading rows


def _load_item(db: Session, item_id: int) -> CardItem:
    """Re-read one item from the database, never from the identity map.

    `expire_on_commit` is off on the session (Section 6.5.2), so an instance left over from a
    transaction still carries pre-commit values; `populate_existing` forces the SELECT. Inside a
    `write_tx` this is also the re-read under the write lock of Section 6.7.2 step 6.
    """
    row = db.get(CardItem, item_id, populate_existing=True)
    if row is None:  # pragma: no cover - the router's dependency resolved it a moment ago
        raise NotFound("not_found", "That item does not exist.")
    return row


def _load_card(db: Session, card_id: int) -> Card:
    """The card an item hangs off, re-read under the lock for its title and list."""
    card = db.get(Card, card_id, populate_existing=True)
    if card is None:  # pragma: no cover - ON DELETE CASCADE removes the item with the card
        raise NotFound("not_found", "That card does not exist.")
    return card


# --------------------------------------------------------------------------- items


def create_items(
    db: Session,
    *,
    board_id: int,
    card_id: int,
    name: str,
    index: int | None = None,
    split_lines: bool = False,
) -> Batch:
    """Add an item to a card, or one per pasted line with `split_lines` (Section 4.6).

    An absent `index` appends; an explicit one walks forward a slot per line so the pasted order
    survives. One `item.added` row per item, all in one transaction and therefore one version
    bump. Raises `NotFound` when the card is gone and `Busy` (503) when the write lock cannot be
    taken.
    """
    names = split_pasted_lines(name, split_lines=split_lines)
    with write_tx(db, [board_id]) as ctx:
        card = _load_card(db, card_id)
        created: list[int] = []
        for offset, line in enumerate(names):
            # A renumber here is not reported: the create response is `Mutated`, which carries no
            # `positions` map (Section 4.6), and the client's next card read repairs the order.
            position, _ = place_in_container(
                db,
                CardItem,
                "card_id",
                card_id,
                index=None if index is None else index + offset,
            )
            item = CardItem(card_id=card_id, name=line, position=position)
            db.add(item)
            db.flush()  # the id the activity row needs; autoflush is off (Section 6.5.2)
            activity.record(
                ctx,
                "item.added",
                card_id=card.id,
                list_id=card.list_id,
                card_title=card.title,
                item_id=item.id,
                item_name=line,
            )
            created.append(item.id)
    return Batch(
        items=[card_item_out(_load_item(db, item_id)) for item_id in created],
        board_version=ctx.board_version,
    )


def update_item(db: Session, *, board_id: int, item_id: int, changes: dict[str, Any]) -> Mutation:
    """Patch one item, one activity row per changed field (Sections 4.6 and 3.8).

    `changes` is the `exclude_unset` dump of `ItemUpdateIn`, so `due_at: None` removes the due
    date; a value equal to the stored one records nothing. Ticking stamps `checked_at` and
    clearing it nulls it again. The returned item carries the card's recomputed `badges`, so the
    tile's `item_done / item_total` is patched from this one round trip. Raises `Busy` (503).
    """
    with write_tx(db, [board_id]) as ctx:
        item = _load_item(db, item_id)
        card = _load_card(db, item.card_id)

        def record(type: str, **data: Any) -> None:
            """One row for one changed field, with the names Section 3.8 denormalises."""
            activity.record(
                ctx,
                type,
                card_id=card.id,
                list_id=card.list_id,
                card_title=card.title,
                item_id=item_id,
                **data,
            )

        name = changes.get("name")
        if name is not None and name != item.name:
            record("item.renamed", item_name=name, **{"from": item.name})
            item.name = name
        is_checked = changes.get("is_checked")
        if is_checked is not None and is_checked != bool(item.is_checked):
            item.is_checked = int(is_checked)
            item.checked_at = utcnow_iso() if is_checked else None
            record("item.checked" if is_checked else "item.unchecked", item_name=item.name)
        if "due_at" in changes and changes["due_at"] != item.due_at:
            item.due_at = changes["due_at"]
            if item.due_at is None:
                record("item.due_removed", item_name=item.name)
            else:
                record("item.due_set", item_name=item.name, due_at=item.due_at)
        card_id = card.id
    return Mutation(
        item=card_item_out(_load_item(db, item_id)) | {"badges": card_badges(db, card_id=card_id)},
        board_version=ctx.board_version,
    )


def delete_item(db: Session, *, board_id: int, item_id: int) -> None:
    """Delete one item (Section 4.6). Activity `item.deleted`."""
    with write_tx(db, [board_id]) as ctx:
        item = _load_item(db, item_id)
        card = _load_card(db, item.card_id)
        activity.record(
            ctx,
            "item.deleted",
            card_id=card.id,
            list_id=card.list_id,
            card_title=card.title,
            item_id=item_id,
            item_name=item.name,
        )
        db.delete(item)


def move_item(
    db: Session,
    *,
    board_id: int,
    item_id: int,
    index: int,
    prev_id: int | None = None,
    next_id: int | None = None,
) -> Move:
    """Reorder an item inside its card (Sections 4.6, 4.9 and 3.6).

    One `UPDATE card_items SET position = ?` from a position `ordering.place_in_container`
    computes with the item itself excluded. The card is the only container an item has, so a move
    names no destination. Activity `item.moved` (SSE only, not shown in the feed). Raises
    `BadRequest` (400) when a neighbour breaks the invariant of `ordering.check_neighbours`, and
    `Busy` (503).
    """
    with write_tx(db, [board_id]) as ctx:
        item = _load_item(db, item_id)
        card = _load_card(db, item.card_id)
        check_neighbours(
            db,
            CardItem,
            "card_id",
            card.id,
            noun="item",
            moved_id=item_id,
            prev_id=prev_id,
            next_id=next_id,
        )
        position, renumbered = place_in_container(
            db,
            CardItem,
            "card_id",
            card.id,
            index=index,
            prev_id=prev_id,
            next_id=next_id,
            exclude_id=item_id,
        )
        activity.record(
            ctx,
            "item.moved",
            card_id=card.id,
            list_id=card.list_id,
            card_title=card.title,
            item_id=item_id,
            item_name=item.name,
            index=index,
        )
        item.position = position
    return Move(
        item=card_item_out(_load_item(db, item_id)),
        positions=renumbered,
        board_version=ctx.board_version,
    )
