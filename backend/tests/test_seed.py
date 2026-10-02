"""Seeding and the maintenance subcommands (Sections 3.10 and 6.13).

The tests drive `kanban.cli.main()` rather than the `seed` functions directly, because the CLI is
the public interface of both (CLAUDE.md section 6). They run in definition order on one module
database: the demo fixture is created once and the tests that follow read it, which is exactly the
sequence an operator performs.
"""

from collections.abc import Iterable
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from kanban import cli, seed
from kanban import db as db_module
from kanban.config import settings
from kanban.constants import BOARD_COLORS
from kanban.models import (
    Board,
    BoardBackground,
    Card,
    CardItem,
    CardLabel,
    Label,
    List,
    utcnow_iso,
)


def _demo_board(db: Session, name: str) -> Board:
    """One example board by name, which is also the assertion that there is exactly one."""
    return db.execute(
        select(Board).where(Board.name == name)
    ).scalar_one()  # scalar_one raises when a rerun created a second copy


def _spec(name: str) -> seed._DemoBoard:
    """The fixture definition behind one example board."""
    return next(board for board in seed.DEMO_BOARDS if board.name == name)


def _count(db: Session, model: type[List] | type[Label] | type[Card], board_id: int) -> int:
    return db.execute(
        select(func.count()).select_from(model).where(model.board_id == board_id)
    ).scalar_one()


def _cards(db: Session, board_id: int) -> list[tuple[str, str]]:
    """The board's cards as (list name, title) pairs, in list then card order."""
    return [
        (row.name, row.title)
        for row in db.execute(
            select(List.name, Card.title)
            .join(Card, Card.list_id == List.id)
            .where(List.board_id == board_id)
            .order_by(List.position, Card.position, Card.id)
        )
    ]


def _by_title(rows: Iterable[tuple[str, str]]) -> dict[str, set[str]]:
    """Collect (card title, value) rows into title -> values, skipping the untouched cards."""
    grouped: dict[str, set[str]] = {}
    for title, value in rows:
        grouped.setdefault(title, set()).add(value)
    return grouped


def _card_label_colors(db: Session, board_id: int) -> dict[str, set[str]]:
    """Card title -> the colours of the labels the fixture put on it."""
    return _by_title(
        db.execute(
            select(Card.title, Label.color)
            .join(CardLabel, CardLabel.card_id == Card.id)
            .join(Label, Label.id == CardLabel.label_id)
            .where(Card.board_id == board_id)
        ).all()
    )


def test_seed_without_a_fixture_flag_seeds_nothing(
    database: None, capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["seed"]) == 0
    assert "Nothing to seed" in capsys.readouterr().out


def test_seed_demo_creates_every_example_board_with_its_own_columns(
    database: None, db: Session, capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["seed", "--demo"]) == 0
    assert "created" in capsys.readouterr().out

    for spec in seed.DEMO_BOARDS:
        board = _demo_board(db, spec.name)
        assert board.background_value == BOARD_COLORS[spec.color]
        # Its own columns, not the `To Do / Doing / Done` a hand-made board starts with.
        names = db.execute(
            select(List.name).where(List.board_id == board.id).order_by(List.position)
        ).scalars()
        assert tuple(names) == spec.lists
        # Every board still gets the six default labels of Section 3.10.
        colors = db.execute(
            select(Label.color).where(Label.board_id == board.id).order_by(Label.position)
        ).scalars()
        assert tuple(colors) == seed.DEFAULT_LABEL_COLORS


def test_seed_demo_appends_each_board_s_cards_in_order(database: None, db: Session) -> None:
    """Runs on the fixture the test above seeded; the module keeps one database throughout."""
    for spec in seed.DEMO_BOARDS:
        board = _demo_board(db, spec.name)
        assert _count(db, Card, board.id) == len(spec.cards)
        assert _cards(db, board.id) == [(card.list_name, card.title) for card in spec.cards]


def test_seed_demo_puts_the_documented_labels_on_its_cards(database: None, db: Session) -> None:
    for spec in seed.DEMO_BOARDS:
        board = _demo_board(db, spec.name)
        assert _card_label_colors(db, board.id) == {
            card.title: set(card.label_colors) for card in spec.cards if card.label_colors
        }


def test_seed_demo_fills_in_every_badge_the_board_page_renders(database: None, db: Session) -> None:
    """Between them the four boards carry a description, a due date and an overdue one."""
    now = utcnow_iso()
    described: list[str] = []
    future: list[str] = []
    past: list[str] = []
    for spec in seed.DEMO_BOARDS:
        board = _demo_board(db, spec.name)
        cards = {
            row.title: row
            for row in db.execute(select(Card).where(Card.board_id == board.id)).scalars()
        }
        for card in spec.cards:
            row = cards[card.title]
            assert (row.description or "") == card.description
            if card.description:
                described.append(card.title)
            if card.due_in_days is None:
                assert row.due_at is None
                continue
            assert row.due_at is not None and not row.due_complete
            if card.due_in_days > 0:
                assert row.due_at > now
                future.append(card.title)
            elif card.due_in_days < 0:
                assert row.due_at < now
                past.append(card.title)
            else:
                assert row.due_at <= now  # the card due today

    assert described and future and past


def test_seed_demo_ticks_the_leading_items_of_each_card(database: None, db: Session) -> None:
    """The ticks are what a tile lists under the title (Section 2.5.1)."""
    for spec in seed.DEMO_BOARDS:
        board = _demo_board(db, spec.name)
        rows = db.execute(
            select(Card.title, CardItem.name, CardItem.is_checked, CardItem.checked_at)
            .join(Card, Card.id == CardItem.card_id)
            .where(Card.board_id == board.id)
            .order_by(Card.position, CardItem.position)
        ).all()
        by_card: dict[str, list[tuple[str, bool, bool]]] = {}
        for title, name, is_checked, checked_at in rows:
            by_card.setdefault(title, []).append((name, bool(is_checked), checked_at is not None))

        for card in spec.cards:
            seeded = by_card.get(card.title, [])
            assert [name for name, _checked, _stamped in seeded] == list(card.items)
            expected = [index < card.checked for index in range(len(card.items))]
            assert [checked for _name, checked, _stamped in seeded] == expected
            # Ticking through the service stamps `checked_at`; an unticked row carries none.
            assert [stamped for _name, _checked, stamped in seeded] == expected


def test_seed_demo_is_idempotent(
    database: None, db: Session, capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["seed", "--demo"]) == 0
    assert "already present" in capsys.readouterr().out

    for spec in seed.DEMO_BOARDS:
        board = _demo_board(db, spec.name)  # raises if the rerun created a second copy
        assert _count(db, List, board.id) == len(spec.lists)
        assert _count(db, Label, board.id) == 6
        assert _count(db, Card, board.id) == len(spec.cards)  # not appended a second time


def test_the_big_fixture_is_thirty_lists_of_a_hundred_cards() -> None:
    """Section 3.10 fixes the size the M2 and M5 performance checks measure."""
    assert (seed.BIG_LIST_COUNT, seed.BIG_CARDS_PER_LIST) == (30, 100)


def test_seed_big_fills_a_board_of_its_own_and_is_idempotent(
    database: None,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """The real 30 x 100 board takes far too long for the suite, so the shape is checked small.

    `seed_big` reads both counts from the module on every call, which is what lets this shrink
    them; the test above is what keeps the shipped numbers at the documented 30 x 100.
    """
    monkeypatch.setattr(seed, "BIG_LIST_COUNT", 2)
    monkeypatch.setattr(seed, "BIG_CARDS_PER_LIST", 3)
    # The shipped fixture scatters items over a quarter of its cards, which six cards are too
    # few to observe; at 1.0 every card gets some, so the test sees the same code path.
    monkeypatch.setattr(seed, "BIG_ITEMS_SHARE", 1.0)

    assert cli.main(["seed", "--big"]) == 0
    assert "created" in capsys.readouterr().out

    board = db.execute(select(Board).where(Board.name == seed.BIG_BOARD_NAME)).scalar_one()
    assert board.background_value == seed.BIG_BOARD_BACKGROUND
    assert _count(db, List, board.id) == 2
    assert _count(db, Card, board.id) == 6
    assert [title for _list_name, title in _cards(db, board.id)] == [
        f"Card {list_index}-{card_index}" for list_index in (1, 2) for card_index in (1, 2, 3)
    ]
    # Every card's `short_id` comes from the service, so the board numbers its cards 1..6.
    short_ids = db.execute(select(Card.short_id).where(Card.board_id == board.id)).scalars()
    assert sorted(short_ids) == [1, 2, 3, 4, 5, 6]

    # Section 3.10 also asks `--big` for random items: every card here carries some.
    carded = db.execute(
        select(CardItem.card_id, func.count(CardItem.id))
        .join(Card, Card.id == CardItem.card_id)
        .where(Card.board_id == board.id)
        .group_by(CardItem.card_id)
    ).all()
    assert len(carded) == 6
    assert all(1 <= count <= 5 for _card_id, count in carded)

    assert cli.main(["seed", "--big"]) == 0
    assert "already present" in capsys.readouterr().out
    assert _count(db, Card, board.id) == 6


@pytest.fixture
def background_with_a_file() -> tuple[int, Path]:
    """A `board_backgrounds` row whose file exists on disk, and that file.

    `cleanup-orphans` reconciles the two, so the row has to exist before any endpoint could have
    created it; this is the one fixture that inserts rows directly (the same exception conftest
    documents), through the app's own lock discipline.
    """
    session = db_module.SessionLocal()
    try:
        with db_module.unversioned_write(session):
            background = BoardBackground(
                file_path="",
                thumb_path="",
                mime_type="image/png",
                size_bytes=12,
                width=4,
                height=4,
            )
            session.add(background)
            session.flush()
            background.file_path = f"backgrounds/{background.id}.png"
            background.thumb_path = f"backgrounds/{background.id}.thumb.jpg"
            background_id = background.id
    finally:
        session.close()

    directory = settings.uploads_dir / "backgrounds"
    directory.mkdir(parents=True, exist_ok=True)
    kept = directory / f"{background_id}.png"
    kept.write_bytes(b"kept")
    return background_id, kept


def test_cleanup_orphans_removes_only_unreferenced_files(
    background_with_a_file: tuple[int, Path], capsys: pytest.CaptureFixture[str]
) -> None:
    _background_id, referenced = background_with_a_file
    orphan = settings.uploads_dir / "backgrounds" / "999999.png"
    orphan.write_bytes(b"crashed mid-upload")

    assert cli.main(["cleanup-orphans"]) == 0

    output = capsys.readouterr().out
    assert not orphan.exists()
    assert referenced.read_bytes() == b"kept"
    assert str(orphan) in output
    assert "dangling row" not in output


def test_cleanup_orphans_dry_run_keeps_the_file(
    database: None, capsys: pytest.CaptureFixture[str]
) -> None:
    orphan = settings.uploads_dir / "backgrounds" / "888888.png"
    orphan.parent.mkdir(parents=True, exist_ok=True)
    orphan.write_bytes(b"still here")

    assert cli.main(["cleanup-orphans", "--dry-run"]) == 0

    assert orphan.is_file()
    assert "orphan (kept)" in capsys.readouterr().out
    orphan.unlink()
