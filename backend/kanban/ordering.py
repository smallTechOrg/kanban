"""Position arithmetic for every ordered table (Sections 3.6 and 4.9).

This module is the only place a `position` is computed (CLAUDE.md section 3). The client never
sends or computes one: it sends a 0-based `index` over the *active* siblings of the destination
container, plus the neighbour ids `prev_id` / `next_id` when it has them, and the server answers
with the authoritative position. The neighbour invariant those ids must satisfy (Section 3.6) is
declared once for every move endpoint here too, in `check_neighbours`.
"""

from collections.abc import Sequence
from typing import Any

from sqlalchemy import case, literal, select, update
from sqlalchemy.orm import Session

from kanban.errors import BadRequest

STEP = 65536.0  # spacing for appends / renumbering
MIN_GAP = 1e-4  # renumber when a neighbour gap collapses below this
MAX_POS = 2.0**52  # renumber when any position exceeds this


def between(prev: float | None, nxt: float | None) -> float:
    """The position between two neighbours; either may be absent at the ends of a container."""
    if prev is None and nxt is None:
        return STEP
    if prev is None:
        return nxt / 2
    if nxt is None:
        return prev + STEP
    return (prev + nxt) / 2


def place_in_container(
    db: Session,
    model: type[Any],
    parent_col: str,
    parent_id: int,
    *,
    index: int | None = None,
    prev_id: int | None = None,
    next_id: int | None = None,
    exclude_id: int | None = None,
) -> tuple[float, dict[int, float]]:
    """Return (position, renumbered). Must be called inside `write_tx()`; never from the client.

    `index` is a 0-based slot among ACTIVE (non-archived) siblings, which is what the client sees;
    prev_id / next_id are matched over ALL siblings (archived included) so a stale client view
    still lands next to the right neighbours. If BOTH neighbour ids are stale (neither row exists
    any more) the call falls back to the index form with index=len(active) (append), because
    between(None, None) = STEP could collide with the first row after a renumber. `renumbered`
    maps id -> new position for every other row the call had to rewrite (empty in the normal case).
    """
    rows = db.execute(
        select(
            model.id,
            model.position,
            getattr(model, "is_archived", literal(0)).label("is_archived"),
        )
        .where(getattr(model, parent_col) == parent_id, model.id != exclude_id)
        .order_by(model.position, model.id)
    ).all()  # archived rows INCLUDED: they keep their slot
    active = [row for row in rows if not row.is_archived]
    prev: float | None = None
    nxt: float | None = None
    if prev_id is not None or next_id is not None:
        by_id = {row.id: row.position for row in rows}
        prev, nxt = by_id.get(prev_id), by_id.get(next_id)  # a vanished id falls back to the other
        if prev is None and nxt is None:  # both stale: use the index form (append)
            prev_id = next_id = None
            index = len(active)
    if prev_id is None and next_id is None:
        index = max(0, min(index if index is not None else len(active), len(active)))
        prev = active[index - 1].position if index > 0 else None
        nxt = active[index].position if index < len(active) else None
    pos = between(prev, nxt)
    too_tight = (prev is not None and pos - prev < MIN_GAP) or (
        nxt is not None and nxt - pos < MIN_GAP
    )
    if too_tight or pos > MAX_POS:
        renumbered = renormalize(db, model, parent_col, parent_id, exclude_id=exclude_id)
        pos, _ = place_in_container(
            db,
            model,
            parent_col,
            parent_id,
            index=index,
            prev_id=prev_id,
            next_id=next_id,
            exclude_id=exclude_id,
        )
        return pos, renumbered
    return pos, {}


def renormalize(
    db: Session,
    model: type[Any],
    parent_col: str,
    parent_id: int,
    *,
    exclude_id: int | None = None,
) -> dict[int, float]:
    """Rewrite ALL siblings (archived included, so archived rows keep their relative slot)
    to STEP, 2*STEP, 3*STEP ... in one UPDATE ... CASE inside the current transaction.
    """
    ids = (
        db.execute(
            select(model.id)
            .where(getattr(model, parent_col) == parent_id, model.id != exclude_id)
            .order_by(model.position, model.id)
        )
        .scalars()
        .all()
    )
    renumbered = {row_id: i * STEP for i, row_id in enumerate(ids, start=1)}
    if renumbered:
        db.execute(
            update(model)
            .where(model.id.in_(renumbered))
            .values(position=case(renumbered, value=model.id))
        )
    return renumbered


def renumber(db: Session, model: type[Any], ordered_ids: Sequence[int]) -> dict[int, float]:
    """Rewrite `ordered_ids` to STEP, 2*STEP, ... in one `UPDATE ... CASE` (Section 3.6).

    The `renormalize` variant that takes an explicit order, which "Sort list" and "Move all
    cards" need: the order comes from the caller, the spacing still comes from `STEP`, so no
    position is invented outside this module. Returns the id -> position map those endpoints
    answer with. Must be called inside `write_tx()`.
    """
    positions = {row_id: STEP * rank for rank, row_id in enumerate(ordered_ids, start=1)}
    if positions:
        db.execute(
            update(model)
            .where(model.id.in_(positions))
            .values(position=case(positions, value=model.id))
        )
    return positions


def check_neighbours(
    db: Session,
    model: type[Any],
    parent_col: str,
    parent_id: int,
    *,
    noun: str,
    moved_id: int,
    prev_id: int | None,
    next_id: int | None,
) -> None:
    """Enforce the neighbour invariant of Section 3.6 for every move endpoint.

    `prev_id` / `next_id` are the ids that will surround the moved row *after* the move, so the
    moved row may never be one of them, the two may not be the same row (`between(p, p)` is `p`:
    a duplicate position whose zero gap would renormalise on every retry) and each one that still
    exists must belong to the destination container `parent_id`. Raises `BadRequest` (400
    `bad_request`) otherwise; an id that no longer exists is a stale client view, which
    `place_in_container` handles by falling back to the other side or to `index`.

    Every caller of `place_in_container` that forwards client-supplied neighbours calls this
    first: the invariant is declared once for all four move endpoints (Sections 3.6 and 4.9) and
    is therefore checked in one place.
    """
    neighbours = [row_id for row_id in (prev_id, next_id) if row_id is not None]
    if moved_id in neighbours:
        raise BadRequest(
            "bad_request", f"A {noun} cannot be its own neighbour.", {f"{noun}_id": moved_id}
        )
    if prev_id is not None and prev_id == next_id:
        raise BadRequest(
            "bad_request",
            f"prev_id and next_id must be different {noun}s.",
            {f"{noun}_id": prev_id},
        )
    if not neighbours:
        return
    container = parent_col.removesuffix("_id")
    foreign = [
        row.id
        for row in db.execute(
            select(model.id, getattr(model, parent_col).label("parent_id")).where(
                model.id.in_(neighbours)
            )
        ).all()
        if row.parent_id != parent_id
    ]
    if foreign:
        raise BadRequest(
            "bad_request",
            f"That neighbour is not a {noun} of the destination {container}.",
            {f"{container}_id": parent_id, f"{noun}_ids": foreign},
        )
