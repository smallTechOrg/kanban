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
from kanban.models import (
    Attachment,
    Board,
    BoardStar,
    Card,
    CardLabel,
    Checklist,
    ChecklistItem,
    Label,
    List,
    utcnow_iso,
)
from kanban.ordering import STEP


def _demo_board(db: Session) -> Board:
    """The single demo board, which is also the assertion that there is exactly one."""
    return db.execute(
        select(Board).where(Board.name == seed.DEMO_BOARD_NAME)
    ).scalar_one()  # scalar_one raises when a rerun created a second copy


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


def test_seed_demo_creates_one_board_with_three_lists_and_six_labels(
    database: None, db: Session, capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["seed", "--demo"]) == 0
    assert "created" in capsys.readouterr().out

    board = _demo_board(db)
    assert board.background_value == seed.DEMO_BOARD_BACKGROUND
    assert _count(db, List, board.id) == 3
    assert _count(db, Label, board.id) == 6

    names = db.execute(
        select(List.name).where(List.board_id == board.id).order_by(List.position)
    ).scalars()
    assert tuple(names) == seed.DEFAULT_LIST_NAMES

    colors = db.execute(
        select(Label.color).where(Label.board_id == board.id).order_by(Label.position)
    ).scalars()
    assert tuple(colors) == seed.DEFAULT_LABEL_COLORS


def test_seed_demo_appends_the_eight_section_3_10_cards(database: None, db: Session) -> None:
    """Runs on the fixture the test above seeded; the module keeps one database throughout."""
    board = _demo_board(db)

    assert _count(db, Card, board.id) == 8
    assert _cards(db, board.id) == [(card.list_name, card.title) for card in seed.DEMO_CARDS]


def test_seed_demo_puts_the_documented_labels_on_its_cards(database: None, db: Session) -> None:
    board = _demo_board(db)

    assert _card_label_colors(db, board.id) == {
        card.title: set(card.label_colors) for card in seed.DEMO_CARDS if card.label_colors
    }


def test_seed_demo_fills_in_the_badge_each_card_exists_to_show(database: None, db: Session) -> None:
    """Section 3.10: a description, a due date tomorrow, an overdue one and the template card."""
    board = _demo_board(db)
    cards = {
        row.title: row
        for row in db.execute(select(Card).where(Card.board_id == board.id)).scalars()
    }
    now = utcnow_iso()

    described = cards["Read this board first"]
    assert described.description is not None
    assert "demo fixture" in described.description

    due_tomorrow = cards["Write the launch announcement"]
    assert due_tomorrow.due_at is not None and due_tomorrow.due_at > now
    assert not due_tomorrow.due_complete

    overdue = cards["Renew the TLS certificate"]
    assert overdue.due_at is not None and overdue.due_at < now

    assert cards["Weekly retro"].is_template

    covered = cards["Choose the brand photography"]
    assert (covered.cover_type, covered.cover_value, covered.cover_size) == (
        "color",
        "sky",
        "normal",
    )

    # The cards the fixture leaves plain stay plain, so each badge has exactly one demo.
    assert cards["Migrate DNS"].description in (None, "")
    assert cards["Migrate DNS"].due_at is None
    assert cards["Migrate DNS"].cover_type is None


def test_seed_demo_adds_the_two_of_five_checklist(database: None, db: Session) -> None:
    board = _demo_board(db)
    checklist = db.execute(
        select(Checklist).join(Card, Card.id == Checklist.card_id).where(Card.board_id == board.id)
    ).scalar_one()  # scalar_one: the fixture documents exactly one checklist
    assert checklist.name == "Launch tasks"

    items = db.execute(
        select(ChecklistItem)
        .where(ChecklistItem.checklist_id == checklist.id)
        .order_by(ChecklistItem.position)
    ).scalars()
    checked = [(item.name, bool(item.is_checked), item.checked_at is not None) for item in items]

    assert len(checked) == 5
    assert [is_checked for _name, is_checked, _stamped in checked] == [
        True,
        True,
        False,
        False,
        False,
    ]
    # Ticking through the service stamps `checked_at`; an unticked row must not carry one.
    assert [stamped for _name, _is_checked, stamped in checked] == [
        True,
        True,
        False,
        False,
        False,
    ]


def test_seed_demo_stars_its_board(database: None, db: Session) -> None:
    """Section 3.10 asks for the fixture board to arrive starred, so Home opens on it."""
    board = _demo_board(db)

    assert (
        db.execute(select(BoardStar.id).where(BoardStar.board_id == board.id)).scalar_one_or_none()
        is not None
    )


def test_seed_demo_is_idempotent(
    database: None, db: Session, capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["seed", "--demo"]) == 0
    assert "already present" in capsys.readouterr().out

    board = _demo_board(db)  # raises if the rerun added a second "Welcome to Kan Ban"
    assert _count(db, List, board.id) == 3
    assert _count(db, Label, board.id) == 6
    assert _count(db, Card, board.id) == 8  # the cards were not appended a second time


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
    # The shipped fixture scatters checklists over a quarter of its cards, which six cards are
    # too few to observe; at 1.0 every card gets one, so the test sees the same code path.
    monkeypatch.setattr(seed, "BIG_CHECKLIST_SHARE", 1.0)

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

    # Section 3.10 also asks `--big` for random checklists: one per card here, each with items.
    carded = db.execute(
        select(Checklist.card_id, func.count(ChecklistItem.id))
        .join(Card, Card.id == Checklist.card_id)
        .join(ChecklistItem, ChecklistItem.checklist_id == Checklist.id)
        .where(Card.board_id == board.id)
        .group_by(Checklist.card_id)
    ).all()
    assert len(carded) == 6
    assert all(1 <= count <= 5 for _card_id, count in carded)

    assert cli.main(["seed", "--big"]) == 0
    assert "already present" in capsys.readouterr().out
    assert _count(db, Card, board.id) == 6


@pytest.fixture
def attachment_with_a_file(board_id: int) -> tuple[int, Path]:
    """An `attachments` row whose directory exists on disk, and that directory.

    `cleanup-orphans` reconciles the two, so the row has to exist before any endpoint could have
    created it; this is the one fixture that inserts rows directly (the same exception conftest
    documents), through the app's own lock discipline.
    """
    session = db_module.SessionLocal()
    try:
        with db_module.unversioned_write(session):
            board_list = List(board_id=board_id, name="Files", position=STEP)
            session.add(board_list)
            session.flush()
            card = Card(
                board_id=board_id,
                list_id=board_list.id,
                short_id=1,
                title="Has an attachment",
                position=STEP,
            )
            session.add(card)
            session.flush()
            attachment = Attachment(card_id=card.id, kind="upload", name="notes.txt", url="")
            session.add(attachment)
            session.flush()
            attachment.file_path = f"attachments/{attachment.id}/notes.txt"
            attachment.url = f"/uploads/{attachment.file_path}"
            attachment_id = attachment.id
    finally:
        session.close()

    directory = settings.uploads_dir / "attachments" / str(attachment_id)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "notes.txt").write_text("kept", encoding="utf-8")
    return attachment_id, directory


def test_cleanup_orphans_removes_only_unreferenced_directories(
    attachment_with_a_file: tuple[int, Path], capsys: pytest.CaptureFixture[str]
) -> None:
    _attachment_id, referenced = attachment_with_a_file
    orphan = settings.uploads_dir / "attachments" / "999999"
    orphan.mkdir(parents=True, exist_ok=True)
    (orphan / "leftover.bin").write_bytes(b"crashed mid-upload")

    assert cli.main(["cleanup-orphans"]) == 0

    output = capsys.readouterr().out
    assert not orphan.exists()
    assert (referenced / "notes.txt").read_text(encoding="utf-8") == "kept"
    assert str(orphan) in output
    assert "dangling row" not in output


def test_cleanup_orphans_dry_run_keeps_the_directory(
    database: None, capsys: pytest.CaptureFixture[str]
) -> None:
    orphan = settings.uploads_dir / "attachments" / "888888"
    orphan.mkdir(parents=True, exist_ok=True)

    assert cli.main(["cleanup-orphans", "--dry-run"]) == 0

    assert orphan.is_dir()
    assert "orphan (kept)" in capsys.readouterr().out
    orphan.rmdir()
