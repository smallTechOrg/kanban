"""Position arithmetic (Sections 3.6 and 4.9)."""

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from sqlalchemy import select
from sqlalchemy.orm import Session

from kanban.models import Board, Label, List
from kanban.ordering import MIN_GAP, STEP, between, place_in_container

TOP_INSERTS = 200

#: One renormalisation absorbs roughly 30 midpoint inserts at the same spot, so 200 top-inserts
#: need a handful. The point of the assertion is that the count stays O(inserts / 30).
MAX_RENORMALISATIONS = 20


def _positions(db: Session, board_id: int) -> list[float]:
    return list(
        db.execute(
            select(List.position).where(List.board_id == board_id).order_by(List.position, List.id)
        ).scalars()
    )


def test_between_spaces_an_empty_container_by_one_step() -> None:
    assert between(None, None) == STEP


def test_between_halves_towards_the_top_and_appends_at_the_bottom() -> None:
    assert between(None, STEP) == STEP / 2
    assert between(STEP, None) == 2 * STEP
    assert between(STEP, 2 * STEP) == 1.5 * STEP


def test_two_hundred_top_inserts_stay_strictly_ordered(db: Session, board_id: int) -> None:
    renormalisations = 0

    for index in range(TOP_INSERTS):
        position, renumbered = place_in_container(db, List, "board_id", board_id, index=0)
        if renumbered:
            renormalisations += 1
        db.add(List(board_id=board_id, name=f"List {index}", position=position))
        db.flush()

    positions = _positions(db, board_id)
    assert len(positions) == TOP_INSERTS
    assert positions == sorted(positions)
    assert len(set(positions)) == TOP_INSERTS
    assert all(b - a >= MIN_GAP for a, b in zip(positions, positions[1:], strict=False))
    assert 0 < renormalisations <= MAX_RENORMALISATIONS


@given(
    siblings=st.integers(min_value=0, max_value=8),
    target_index=st.integers(min_value=0, max_value=12),
)
@settings(
    deadline=None,
    max_examples=60,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
def test_index_in_equals_index_out(db: Session, siblings: int, target_index: int) -> None:
    """Whatever slot the client asks for, the row lands in it once the rows are re-sorted."""
    board = Board(name="Property board")
    db.add(board)
    db.flush()

    for ordinal in range(siblings):
        position, _ = place_in_container(db, Label, "board_id", board.id, index=ordinal)
        db.add(Label(board_id=board.id, color="green", position=position))
        db.flush()

    position, _ = place_in_container(db, Label, "board_id", board.id, index=target_index)
    inserted = Label(board_id=board.id, color="blue", position=position)
    db.add(inserted)
    db.flush()

    ordered = list(
        db.execute(
            select(Label.id).where(Label.board_id == board.id).order_by(Label.position, Label.id)
        ).scalars()
    )
    assert ordered.index(inserted.id) == min(target_index, siblings)
