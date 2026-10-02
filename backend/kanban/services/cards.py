"""Cards: the composer, the title patch, the move contract, archive/unarchive and delete.

Sections 4.4, 4.5, 3.6 and 6.7.2. Every function here opens exactly one `write_tx()`, records its
`activities` rows through `activity.record()` and gets every `position` from
`ordering.place_in_container()` - never from midpoint maths of its own (CLAUDE.md section 3).

The board is not resolved twice: `routers/cards.py` resolves the card's (or the destination
list's) board through `access.board_access` before a function here is called, which is why each one
takes the `board_id` the router resolved. Live SSE events are
derived from the `activities` rows this module records, by the `Session` listeners of `events.py`,
so nothing here publishes one.

A card never changes board: a move names a list on the board the router already resolved. The two
helpers that hand a row to another board - `target_board()` and `reassign_board()` - survive for
the *list* move of Section 3.6, which carries its whole column across and names its destination
board in the body, where `access.board_access` cannot see it. `services/lists.py` calls both rather
than writing a second copy, exactly as it already calls `next_short_id`.

Because the `CardDetail` of Section 4.5 *is* the card plus its children, this module owns the read
shapes those children are returned in - `card_badges`, `card_label_ids`, `card_item_out`,
`card_items` and `card_items_out` - and `services/labels.py` and `services/items.py` call them
instead of writing a second copy (CLAUDE.md section 3). The dependency can only run this way: both
of those modules already import this one for `next_short_id`, the badges and the card summary, and
the reverse edge would be a circular import.
"""

from collections.abc import Sequence
from typing import Any, NamedTuple

from sqlalchemy import collate, delete, func, select
from sqlalchemy.orm import Session

from kanban import activity
from kanban.db import WriteCtx, write_tx
from kanban.errors import BadRequest, Conflict, NotFound
from kanban.models import Board, Card, CardItem, CardLabel, Label, List
from kanban.ordering import check_neighbours, place_in_container

#: `GET /api/boards/{board_id}/archived` (Section 4.3): the documented page size and the Section
#: 4.1 cursor cap, shared by the cards page here and the lists page of `services/lists.py`.
ARCHIVED_PAGE_LIMIT = 50
MAX_ARCHIVED_PAGE_LIMIT = 200


class CardMutation(NamedTuple):
    """What a single-row card mutation returns: the row plus the version it produced (4.1)."""

    item: dict[str, Any]
    board_version: int


class CardBatch(NamedTuple):
    """What `create_card` returns: one item normally, one per pasted line with `split_lines`."""

    items: list[dict[str, Any]]
    board_version: int


class CardMove(NamedTuple):
    """What `move_card` returns: the `MoveResult` of Section 4.9.

    `positions` is empty unless the destination had to be renumbered; when it is not, it maps
    every *other* row the renumber rewrote to its new position.
    """

    item: dict[str, Any]
    positions: dict[int, float]
    board_version: int


# --------------------------------------------------------------------------- reading one card


def _load(db: Session, card_id: int) -> Card:
    """Re-read a card from the database, never from the identity map.

    `expire_on_commit` is off on the session (Section 6.5.2), so an instance left over from a
    transaction still carries pre-commit values; `populate_existing` forces the SELECT. Inside a
    `write_tx` this is also the re-read under the write lock of Section 6.7.2 step 6.
    """
    card = db.get(Card, card_id, populate_existing=True)
    if card is None:  # pragma: no cover - the router's dependency resolved it a moment ago
        raise NotFound("not_found", "That card does not exist.")
    return card


def _load_list(db: Session, list_id: int) -> List:
    """Re-read one list. Raises `NotFound`, which only a vanished row can trigger."""
    row = db.get(List, list_id, populate_existing=True)
    if row is None:  # pragma: no cover - a card's list cannot vanish (ON DELETE CASCADE)
        raise NotFound("not_found", "That list does not exist.")
    return row


def board_name(db: Session, board_id: int) -> str:
    """The board's current name, for the `other_board_name` a cross-board move denormalises (3.8).

    `services/lists.py` records the same pair of rows for a cross-board list move and reads the
    source board's name from here rather than restating the SELECT.
    """
    return str(db.execute(select(Board.name).where(Board.id == board_id)).scalar_one())


def _board_of_list(db: Session, list_id: int) -> int:
    """Which board a destination list belongs to, read before the transaction opens.

    A copy names its destination by list alone (Section 4.5), so the board whose `version` the
    write bumps - and which `target_board` checks is open - is only known after this one SELECT.
    Raises `BadRequest` (400), never `NotFound`, because `to_list_id` is a body field rather than
    the addressed row, exactly as `_move_target` answers.
    """
    board_id = db.execute(select(List.board_id).where(List.id == list_id)).scalar_one_or_none()
    if board_id is None:
        raise BadRequest("bad_request", "That list does not exist.", {"list_id": list_id})
    return int(board_id)


def _badges(db: Session, card: Card) -> dict[str, Any]:
    """The three badge counts of Section 2.5 for one card, in one statement.

    `board_payload.py` computes the same three values for a whole board with correlated
    sub-selects; this is the single-row form every card mutation answers with.
    """
    items = select(func.count()).select_from(CardItem).where(CardItem.card_id == card.id)
    counts = db.execute(
        select(
            items.scalar_subquery().label("item_total"),
            items.where(CardItem.is_checked == 1).scalar_subquery().label("item_done"),
        )
    ).one()
    return {
        "description": card.description != "",
        "item_done": counts.item_done,
        "item_total": counts.item_total,
    }


def card_badges(db: Session, *, card_id: int) -> dict[str, Any]:
    """The four badge counts of Section 2.5 for one card, addressed by id.

    `services.items` answers its item patch with exactly this object (Section 4.6), so ticking an
    item updates the tile's `item_done / item_total` from the same round trip without assembling
    the whole `CardDetail` around it.
    """
    return _badges(db, _load(db, card_id))


def card_label_ids(db: Session, *, card_id: int) -> list[int]:
    """The card's label ids in the order the chips row renders them (label `position`).

    `CardSummary.label_ids` and the two label toggles of Section 4.5 answer with the same array,
    so `services.labels` reads it from here rather than restating the join.
    """
    return list(
        db.execute(
            select(CardLabel.label_id)
            .join(Label, Label.id == CardLabel.label_id)
            .where(CardLabel.card_id == card_id)
            .order_by(Label.position, Label.id)
        ).scalars()
    )


def _summary(db: Session, card: Card) -> dict[str, Any]:
    """Build the `CardSummary` of Section 4.10.1 for one card.

    `label_ids` are ordered the way the chips row renders them (label `position`), and `items`
    is the array the tile lists under the title (Section 2.5.1) - the same one `CardDetail`
    carries, which is why it is built here rather than once per caller.
    """
    return {
        "id": card.id,
        "client_id": card.client_id,
        "board_id": card.board_id,
        "list_id": card.list_id,
        "short_id": card.short_id,
        "title": card.title,
        "position": card.position,
        "is_archived": bool(card.is_archived),
        "start_at": card.start_at,
        "due_at": card.due_at,
        "due_complete": bool(card.due_complete),
        "label_ids": card_label_ids(db, card_id=card.id),
        "items": card_items_out(db, card.id),
        "badges": _badges(db, card),
        "created_at": card.created_at,
        "updated_at": card.updated_at,
    }


def card_item_out(row: CardItem) -> dict[str, Any]:
    """The `CardItemOut` of Section 4.6 for one `card_items` row."""
    return {
        "id": row.id,
        "card_id": row.card_id,
        "name": row.name,
        "position": row.position,
        "is_checked": bool(row.is_checked),
        "checked_at": row.checked_at,
        "due_at": row.due_at,
    }


def card_items(db: Session, card_id: int) -> list[CardItem]:
    """One card's items in the `(position, id)` order every ordered table is read in (4.9).

    `populate_existing` because `expire_on_commit` is off (Section 6.5.2): a row left over from a
    write transaction would otherwise still carry its pre-commit values.
    """
    return list(
        db.execute(
            select(CardItem)
            .where(CardItem.card_id == card_id)
            .order_by(CardItem.position, CardItem.id)
            .execution_options(populate_existing=True)
        )
        .scalars()
        .all()
    )


def card_items_out(db: Session, card_id: int) -> list[dict[str, Any]]:
    """One card's items as `CardDetail.items` (Sections 4.5 and 4.6).

    Every item mutation of `services/items.py` answers with one of these rows and `CardDetail`
    embeds the whole array, so the shape is written down once.
    """
    return [card_item_out(row) for row in card_items(db, card_id)]


def get_card(db: Session, *, card_id: int) -> dict[str, Any]:
    """One card as the modal needs it: the `CardDetail` of Section 4.5, archived ones included.

    Everything `CardSummary` carries - the items included - plus the description, the reminder
    offset and the board and list names of Section 2.6.2, so opening the modal is one request.
    Raises `NotFound` when the card is gone.
    """
    card = _load(db, card_id)
    names = db.execute(
        select(Board.name.label("board_name"), List.name.label("list_name"))
        .join(List, List.board_id == Board.id)
        .where(List.id == card.list_id)
    ).one()
    return {
        **_summary(db, card),
        "description": card.description,
        "due_reminder_minutes": card.due_reminder_minutes,
        "board_name": names.board_name,
        "list_name": names.list_name,
    }


def card_summary(db: Session, *, card_id: int) -> dict[str, Any]:
    """The `CardSummary` of Section 4.10.1 for one card, re-read from the database.

    What every card mutation answers with: the new tile, not the whole `CardDetail` the modal
    reads.
    """
    return _summary(db, _load(db, card_id))


# --------------------------------------------------------------------------- create


def split_pasted_lines(body: str, *, split_lines: bool) -> list[str]:
    """One row per call, or one per non-empty line of a pasted body (Sections 4.4 and 4.6).

    The rule behind the composer's "Add N cards?" prompt and the identical "Add N items?" prompt
    of a card's item composer, which `services.items` therefore calls rather than restating: lines
    are
    stripped, blank ones dropped, and a body that is nothing but whitespace stays one row (the
    `CardTitle` / `ItemName` constraints guarantee it holds a non-blank character).
    """
    if not split_lines:
        return [body]
    lines = [line.strip() for line in body.splitlines() if line.strip()]
    return lines or [body]


def _create_slot(index: int | str | None, offset: int) -> int | None:
    """The 0-based slot of the `offset`-th line of a `split_lines` paste (Section 4.4).

    `None` and `"bottom"` append, which `place_in_container` does when given no index; `"top"`
    and an explicit slot walk forward one card per line so the pasted order survives.
    """
    if isinstance(index, int):
        return index + offset
    if index == "top":
        return offset
    return None


def _validated_label_ids(db: Session, *, board_id: int, label_ids: Sequence[int]) -> list[int]:
    """The requested labels, deduplicated in request order.

    Raises `BadRequest` for a label that belongs to another board.
    """
    wanted = list(dict.fromkeys(label_ids))
    if not wanted:
        return []
    known = set(
        db.execute(
            select(Label.id).where(Label.board_id == board_id, Label.id.in_(wanted))
        ).scalars()
    )
    missing = [label_id for label_id in wanted if label_id not in known]
    if missing:
        raise BadRequest("bad_request", "That label is not on this board.", {"label_ids": missing})
    return wanted


def next_short_id(db: Session, board_id: int) -> int:
    """`MAX(short_id) + 1` for the board, read inside the write lock (Section 4.5).

    Every card the board gains - from the composer or from a list copy - numbers itself through
    this one helper, so the per-board sequence is defined in a single place.
    """
    highest = db.execute(select(func.max(Card.short_id)).where(Card.board_id == board_id)).scalar()
    return int(highest or 0) + 1


def create_card(
    db: Session,
    *,
    board_id: int,
    list_id: int,
    title: str,
    index: int | str | None = None,
    client_id: str | None = None,
    label_ids: Sequence[int] = (),
    split_lines: bool = False,
) -> CardBatch:
    """Create a card in `list_id`, or one per pasted line with `split_lines` (Section 4.4).

    Every card gets `MAX(short_id) + 1` of its board read under the write lock, the composer's
    `label_ids` and one `card.created` activity row; `client_id` is stored on the first card,
    which is the optimistic tile the composer is waiting for. Raises `BadRequest` when the list is
    archived or a label does not belong to the board, `NotFound` when the list is gone and `Busy`
    (503) when the write lock cannot be taken.
    """
    titles = split_pasted_lines(title, split_lines=split_lines)
    with write_tx(db, [board_id]) as ctx:
        target = _load_list(db, list_id)
        if target.is_archived:
            raise BadRequest("bad_request", "That list is archived.", {"list_id": list_id})
        labels = _validated_label_ids(db, board_id=board_id, label_ids=label_ids)
        short_id = next_short_id(db, board_id)
        created: list[int] = []
        for offset, line in enumerate(titles):
            # A renumber here is not reported: the create response is `Mutated`, which carries no
            # `positions` map (Section 4.4), and the client's next board read repairs the order.
            position, _ = place_in_container(
                db, Card, "list_id", list_id, index=_create_slot(index, offset)
            )
            card = Card(
                board_id=board_id,
                list_id=list_id,
                short_id=short_id + offset,
                title=line,
                position=position,
                client_id=client_id if offset == 0 else None,
            )
            db.add(card)
            db.flush()  # the id the association rows and the activity row need
            for label_id in labels:
                db.add(CardLabel(card_id=card.id, label_id=label_id))
            activity.record(
                ctx,
                "card.created",
                card_id=card.id,
                list_id=list_id,
                card_title=card.title,
                list_name=target.name,
            )
            created.append(card.id)
    return CardBatch(
        items=[card_summary(db, card_id=card_id) for card_id in created],
        board_version=ctx.board_version,
    )


# --------------------------------------------------------------------------- patch


def _record_dates(ctx: WriteCtx, card: Card) -> None:
    """The one activity row a change to `start_at` / `due_at` writes (Sections 4.5 and 3.8).

    The two columns are a single user-visible concern - one `DatesPopover` with one Save and one
    Remove - so they share one row rather than writing two: `card.due_removed` when the card is
    left with no dates at all, `card.due_set` carrying both values otherwise, which is the shape
    the Section 3.8 table gives (`start_at` may be null there). Called with the new values
    already on the row, so `data` is what was stored.
    """
    if card.due_at is None and card.start_at is None:
        activity.record(
            ctx,
            "card.due_removed",
            card_id=card.id,
            list_id=card.list_id,
            card_title=card.title,
        )
    else:
        activity.record(
            ctx,
            "card.due_set",
            card_id=card.id,
            list_id=card.list_id,
            card_title=card.title,
            start_at=card.start_at,
            due_at=card.due_at,
        )


def update_card(
    db: Session, *, board_id: int, card_id: int, changes: dict[str, Any]
) -> CardMutation:
    """Patch a card's scalar fields, one activity row per changed field (Sections 4.5 and 3.8).

    `changes` is the `exclude_unset` dump of `CardUpdateIn`: an absent key is untouched and an
    explicit `None` clears one of the three nullable columns. A value equal to the stored one is
    written but records nothing, so a no-op save never adds a feed entry. `start_at` and `due_at`
    share the single row `_record_dates` writes; `due_complete` records its own pair of types,
    and `due_reminder_minutes` records nothing at all - Section 3.8 has
    no type for it and it is not a fact about the card anybody reads back in a sentence. Raises
    `NotFound` when the card is gone and `Busy` (503) on a lock timeout.
    """
    with write_tx(db, [board_id]) as ctx:
        card = _load(db, card_id)
        if "title" in changes and changes["title"] != card.title:
            activity.record(
                ctx,
                "card.renamed",
                card_id=card_id,
                list_id=card.list_id,
                **{"from": card.title, "to": changes["title"]},
            )
            card.title = changes["title"]
        if "description" in changes and changes["description"] != card.description:
            card.description = changes["description"]
            activity.record(
                ctx,
                "card.description_changed",
                card_id=card_id,
                list_id=card.list_id,
                card_title=card.title,
            )
        dates = {key: changes[key] for key in ("start_at", "due_at") if key in changes}
        if any(value != getattr(card, key) for key, value in dates.items()):
            card.start_at = dates.get("start_at", card.start_at)
            card.due_at = dates.get("due_at", card.due_at)
            _record_dates(ctx, card)
        if "due_reminder_minutes" in changes:
            card.due_reminder_minutes = changes["due_reminder_minutes"]
        if "due_complete" in changes and changes["due_complete"] != bool(card.due_complete):
            card.due_complete = int(changes["due_complete"])
            activity.record(
                ctx,
                "card.due_completed" if card.due_complete else "card.due_incompleted",
                card_id=card_id,
                list_id=card.list_id,
                card_title=card.title,
            )
    return CardMutation(item=card_summary(db, card_id=card_id), board_version=ctx.board_version)


# --------------------------------------------------------------------------- move


def _move_target(db: Session, *, to_list_id: int, board_id: int) -> List:
    """The destination list of a move, verified under the write lock (Section 6.7.2 step 6).

    Raises `BadRequest` (400) - never `NotFound` - when the list does not exist, belongs to
    another board or is archived, because `to_list_id` is a body field, not the addressed row.
    """
    target = db.get(List, to_list_id, populate_existing=True)
    if target is None or target.board_id != board_id:
        raise BadRequest(
            "bad_request",
            "That list is not on this board.",
            {"list_id": to_list_id, "board_id": board_id},
        )
    if target.is_archived:
        raise BadRequest("bad_request", "That list is archived.", {"list_id": to_list_id})
    return target


def target_board(db: Session, *, board_id: int) -> Board:
    """The destination board of a cross-board move or copy, checked as a route would check it.

    The one guard a dependency cannot apply, because `to_board_id` and the destination list arrive
    in the body rather than the path: `access.board_access()` never sees them, so Section 3.6 puts
    the check here. It applies exactly the rules that dependency does and adds none of its own -
    404 `not_found` for a board that is not there, 409 `conflict` "Board is closed" for one that
    is - so a move into another board is refused for the same reasons, and with the same wording,
    as any mutation addressed to it directly.
    """
    board = db.get(Board, board_id)
    if board is None:
        raise NotFound("not_found", "Board not found.")
    if board.is_closed:
        raise Conflict("conflict", "Board is closed", {"board_id": board_id})
    return board


def reassign_board(db: Session, card: Card, *, to_board_id: int) -> None:
    """Hand one card row to another board, with the two fixups Section 3.6 lists.

    A fresh `short_id` from the target board's sequence (`cards` is unique on
    `(board_id, short_id)`), and `card_labels` dropped because labels are per board. The row is
    flushed before returning, so the next card of a list move reads a `MAX(short_id)` that
    already counts this one. Must be called inside `write_tx()`.
    """
    card.board_id = to_board_id
    card.short_id = next_short_id(db, to_board_id)
    db.execute(delete(CardLabel).where(CardLabel.card_id == card.id))
    db.flush()  # the new short_id must be visible to the next `next_short_id` of the same move


def move_card(
    db: Session,
    *,
    board_id: int,
    card_id: int,
    to_list_id: int,
    index: int,
    prev_id: int | None = None,
    next_id: int | None = None,
) -> CardMove:
    """Move a card within its list or to another list of the same board (Sections 4.9 and 3.6).

    The whole sequence runs in one `write_tx`, so the neighbour read and the write are serialised
    by `BEGIN IMMEDIATE` and two simultaneous movers get distinct positions. Neighbours take
    precedence over `index`; both stale falls back to an append. The activity is `card.moved`
    across lists and `card.reordered` within one.

    A card never leaves its board: the destination is a list, and `_move_target` refuses one that
    belongs to another board. Only a *list* carries its cards across (`services/lists.py`).

    Raises `BadRequest` when `to_list_id` is not an active list of this board or a neighbour
    breaks the invariant of `ordering.check_neighbours`, `NotFound` when the card is gone and
    `Busy` (503) on a lock timeout.
    """
    with write_tx(db, [board_id]) as ctx:
        card = _load(db, card_id)
        source = _load_list(db, card.list_id)
        target = _move_target(db, to_list_id=to_list_id, board_id=board_id)
        check_neighbours(
            db,
            Card,
            "list_id",
            to_list_id,
            noun="card",
            moved_id=card_id,
            prev_id=prev_id,
            next_id=next_id,
        )
        position, renumbered = place_in_container(
            db,
            Card,
            "list_id",
            to_list_id,
            index=index,
            prev_id=prev_id,
            next_id=next_id,
            exclude_id=card_id,
        )
        if source.id == target.id:
            activity.record(
                ctx,
                "card.reordered",
                card_id=card_id,
                list_id=target.id,
                card_title=card.title,
                list_name=target.name,
                index=index,
            )
        else:
            activity.record(
                ctx,
                "card.moved",
                card_id=card_id,
                list_id=target.id,
                card_title=card.title,
                from_list_id=source.id,
                from_list_name=source.name,
                to_list_id=target.id,
                to_list_name=target.name,
                index=index,
            )
        card.list_id = target.id
        card.position = position
    return CardMove(
        item=card_summary(db, card_id=card_id),
        positions=renumbered,
        board_version=ctx.board_version,
    )


def archive_card(db: Session, *, board_id: int, card_id: int) -> CardMutation:
    """Archive a card, keeping its `position` so unarchive restores the slot (Sections 3.6, 3.7).

    Idempotent: archiving an archived card writes no row and records nothing. Raises `NotFound`
    when the card is gone and `Busy` (503) on a lock timeout.
    """
    with write_tx(db, [board_id]) as ctx:
        card = _load(db, card_id)
        if not card.is_archived:
            card.is_archived = 1
            activity.record(
                ctx,
                "card.archived",
                card_id=card_id,
                list_id=card.list_id,
                card_title=card.title,
            )
    return CardMutation(item=card_summary(db, card_id=card_id), board_version=ctx.board_version)


def _first_active_list(db: Session, board_id: int) -> List | None:
    """The board's first active list in `position` order, or `None` when every list is archived."""
    return db.execute(
        select(List)
        .where(List.board_id == board_id, List.is_archived == 0)
        .order_by(List.position, List.id)
        .limit(1)
    ).scalar_one_or_none()


def unarchive_card(db: Session, *, board_id: int, card_id: int) -> CardMutation:
    """ "Send to board": clear `is_archived` and restore the original slot (Sections 3.6 and 3.7).

    `position` is untouched, so the card reappears exactly where it was - archived rows keep
    their slot in the neighbour query. If its list is archived the card is appended to the
    board's first active list instead. Raises `Conflict` (409 "Send a list to the board first")
    when the board has no active list at all, in which case nothing changes, `NotFound` when the
    card is gone and `Busy` (503) on a lock timeout. Idempotent for an active card.
    """
    with write_tx(db, [board_id]) as ctx:
        card = _load(db, card_id)
        if card.is_archived:
            if _load_list(db, card.list_id).is_archived:
                target = _first_active_list(db, board_id)
                if target is None:
                    raise Conflict(
                        "conflict", "Send a list to the board first", {"list_id": card.list_id}
                    )
                # No index: `place_in_container` appends after the list's last active card
                # (the "Append" row of Section 3.6).
                position, _ = place_in_container(db, Card, "list_id", target.id)
                card.list_id = target.id
                card.position = position
            card.is_archived = 0
            activity.record(
                ctx,
                "card.unarchived",
                card_id=card_id,
                list_id=card.list_id,
                card_title=card.title,
            )
    return CardMutation(item=card_summary(db, card_id=card_id), board_version=ctx.board_version)


def delete_card(db: Session, *, board_id: int, card_id: int) -> None:
    """Delete a card and its items (Sections 3.7 and 4.5).

    Delete is the one destructive action a card offers, so it does not require the card to be
    archived first: the card modal asks for confirmation instead, because there is no undo
    (Section 2.6.4). The `card.deleted` activity row carries the title and list name in `data`
    with a NULL `card_id`, so the board feed keeps the sentence after the row it names is gone.
    `card_items` go with it through `ON DELETE CASCADE`. Raises `NotFound` when the card is
    already gone and `Busy` (503) on a lock timeout.
    """
    with write_tx(db, [board_id]) as ctx:
        card = _load(db, card_id)
        activity.record(
            ctx,
            "card.deleted",
            list_id=card.list_id,
            card_title=card.title,
            list_name=_load_list(db, card.list_id).name,
        )
        db.delete(card)


def list_archived_cards(
    db: Session,
    *,
    board_id: int,
    q: str | None = None,
    before: int | None = None,
    limit: int = ARCHIVED_PAGE_LIMIT,
) -> tuple[list[dict[str, Any]], int | None]:
    """One page of the board's archived cards, newest first (Section 4.3).

    What the Archived Items panel restores from. Only cards with `is_archived = 1`: a card that is
    merely inside an archived list is not archived itself and comes back with its list, so it is
    not listed here (Sections 3.7 and 4.3). `q` is a case-insensitive substring of the title,
    `before` is an `id` cursor, and the second element of the result is the `next_before` the panel
    pages with - the last row's id when the page was full, `None` when it was the last page.
    """
    statement = select(Card).where(Card.board_id == board_id, Card.is_archived == 1)
    if q:
        statement = statement.where(collate(Card.title, "NOCASE").contains(q, autoescape=True))
    if before is not None:
        statement = statement.where(Card.id < before)
    rows = list(
        db.execute(
            statement.order_by(Card.id.desc())
            .limit(limit)
            .execution_options(populate_existing=True)
        )
        .scalars()
        .all()
    )
    items = [_summary(db, card) for card in rows]
    return items, rows[-1].id if len(rows) == limit else None
