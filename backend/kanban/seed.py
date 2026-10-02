"""Seeding (Section 3.10).

Two paths live here and nowhere else:

1. **Per-board seeding** - `seed_new_board()`, called by `services/boards.py` from inside the
   single `write_tx` that `POST /api/boards` opens. It owns the six default labels, the optional
   `To Do / Doing / Done` lists and the board's one `board.created` activity, so the boards
   service never writes those rows itself.
2. **Demo seeding** - `seed_demo()` (the four example boards behind `kanban seed --demo`) and
   `seed_big()` (the 30 x 100 board behind `kanban seed --big` that the M2 and M5 performance
   checks measure).

Both fixture entry points are **idempotent**: each creates only what is missing and never modifies
a row that already exists, so `kanban seed --demo` can be run any number of times. They go through
`services/` rather than inserting rows, so a seeded board is indistinguishable from one built by
hand - the same positions, `short_id`s and activity trail (CLAUDE.md section 2).
"""

import logging
import random
from collections.abc import Sequence
from typing import Any, Final, NamedTuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from kanban.activity import record
from kanban.constants import BOARD_COLORS, LABEL_COLORS
from kanban.db import WriteCtx
from kanban.models import Board, Label, List, utcnow_iso
from kanban.ordering import STEP

logger = logging.getLogger(__name__)

#: How many of the Section 2.9.2 label colours a new board is seeded with (Section 3.10).
_DEFAULT_LABEL_COUNT: Final[int] = 6

#: The six default labels of every new board, in order (Section 3.10): unnamed, tone `normal`,
#: positions 65536 ... 393216. Read from the one copy of the palette - `green yellow orange red
#: purple blue` are its first six keys - so no colour name is written down twice.
DEFAULT_LABEL_COLORS: Final[tuple[str, ...]] = tuple(LABEL_COLORS)[:_DEFAULT_LABEL_COUNT]

#: The lists created when `POST /api/boards` is sent `default_lists: true` (the default).
DEFAULT_LIST_NAMES: Final[tuple[str, ...]] = ("To Do", "Doing", "Done")

#: The default label tone. `subtle | normal | bold` is a column constraint, not a palette.
_DEFAULT_LABEL_TONE: Final[str] = "normal"

#: The example boards behind `kanban seed --demo` (Section 3.10). They are four ordinary weeks
#: rather than a product tour: a reader who opens one should recognise their own life in it and
#: need no explanation of what a list or a card is for. Between them they cover every badge the
#: board page renders - items with ticks, a due date, an overdue date, a description, labels.
DEMO_BOARD_BACKGROUND_TYPE: Final[str] = "color"


class _DemoCard(NamedTuple):
    """One card of the `--demo` fixture: which list it lands in and what it carries."""

    list_name: str
    title: str
    #: Keys of `constants.LABEL_COLORS`, resolved to the board's six seeded labels - which are
    #: unnamed, so their colour is the only handle on them.
    label_colors: tuple[str, ...] = ()
    #: The Markdown body behind the description badge (Section 2.5.3).
    description: str = ""
    #: Whole days from now for `due_at`: `1` is a card due tomorrow and `-1` an overdue one.
    #: `None` leaves the card with no dates.
    due_in_days: int | None = None
    #: The card's items, and how many of the leading ones arrive checked - which is what the
    #: tile lists under the title and what the `done/total` badge counts (Section 2.5.1).
    items: tuple[str, ...] = ()
    checked: int = 0


class _DemoBoard(NamedTuple):
    """One example board: its colour, its columns and the cards that fill them."""

    name: str
    #: A key of `constants.BOARD_COLORS`, so no colour is written down twice.
    color: str
    lists: tuple[str, ...]
    cards: tuple[_DemoCard, ...]


DEMO_BOARDS: Final[tuple[_DemoBoard, ...]] = (
    _DemoBoard(
        name="Shopping",
        color="green",
        lists=("Need now", "This week", "Bought"),
        cards=(
            _DemoCard(
                "Need now",
                "Weekly groceries",
                items=("Milk", "Bread", "Eggs", "Rice", "Coffee", "Bananas"),
                checked=2,
            ),
            _DemoCard("Need now", "Chemist", items=("Toothpaste", "Plasters")),
            _DemoCard(
                "This week",
                "Birthday present for Mum",
                due_in_days=5,
                description="She mentioned the blue scarf in the shop on the corner.",
            ),
            _DemoCard(
                "This week",
                "Big shop on Saturday",
                items=("Check the fridge first", "Write the list", "Take the bags"),
                checked=1,
            ),
            _DemoCard("Bought", "Washing-up liquid"),
        ),
    ),
    _DemoBoard(
        name="This week",
        color="blue",
        lists=("Today", "This week", "Done"),
        cards=(
            _DemoCard("Today", "Call the dentist", due_in_days=0),
            _DemoCard("Today", "Reply to the landlord", due_in_days=-1, label_colors=("red",)),
            _DemoCard("Today", "Twenty minutes on the bike"),
            _DemoCard(
                "This week",
                "Renew the car insurance",
                due_in_days=4,
                items=("Compare three quotes", "Cancel the old policy", "Save the PDF"),
                checked=1,
            ),
            _DemoCard("This week", "Book a haircut"),
            _DemoCard("Done", "Water the plants"),
        ),
    ),
    _DemoBoard(
        name="Money",
        color="purple",
        lists=("Due soon", "Subscriptions", "Paid"),
        cards=(
            _DemoCard("Due soon", "Rent", due_in_days=3),
            _DemoCard("Due soon", "Phone bill", due_in_days=6),
            _DemoCard("Due soon", "Credit card", due_in_days=-1, label_colors=("red",)),
            _DemoCard("Subscriptions", "Streaming - monthly"),
            _DemoCard("Subscriptions", "Gym - monthly"),
            _DemoCard(
                "Subscriptions",
                "Cloud storage - yearly",
                due_in_days=20,
                items=("Check I still need the big plan", "Renew or cancel"),
            ),
            _DemoCard("Paid", "Electricity"),
        ),
    ),
    _DemoBoard(
        name="Home & errands",
        color="orange",
        lists=("To do", "To fix", "Someday"),
        cards=(
            _DemoCard("To do", "Bins out on Tuesday"),
            _DemoCard("To do", "Post the parcel", due_in_days=2),
            _DemoCard(
                "To do",
                "Clean the kitchen properly",
                items=("Fridge", "Oven", "Cupboards"),
                checked=1,
            ),
            _DemoCard("To fix", "Dripping bathroom tap", label_colors=("orange",)),
            _DemoCard("To fix", "Loose cupboard handle"),
            _DemoCard("Someday", "Repaint the hallway"),
            _DemoCard("Someday", "A bigger desk"),
        ),
    ),
)

#: The names `seed_demo` checks for before it creates anything.
DEMO_BOARD_NAMES: Final[tuple[str, ...]] = tuple(board.name for board in DEMO_BOARDS)

#: The `--big` board of Section 3.10, which the M2 and M5 performance checks load. 30 x 100 is
#: also the board Section 4.10.1 sets the "under 100 ms" payload target against.
BIG_BOARD_NAME: Final[str] = "Performance check"
BIG_BOARD_BACKGROUND: Final[str] = BOARD_COLORS["purple"]
BIG_LIST_COUNT: Final[int] = 30
BIG_CARDS_PER_LIST: Final[int] = 100

#: `--big` scatters labels and items over its cards at random; a fixed seed keeps two runs
#: comparable, so a timing difference is a code change rather than a different fixture.
BIG_RANDOM_SEED: Final[int] = 20260926

#: How many of the board's six labels one `--big` card may carry.
_BIG_MAX_LABELS: Final[int] = 2

#: The share of `--big` cards that get items, and how many they may have: items on every card
#: would only make the fixture slower to build without making the board it measures any denser
#: than a real one.
BIG_ITEMS_SHARE: Final[float] = 0.25
_BIG_MAX_ITEMS: Final[int] = 5


def seed_new_board(ctx: WriteCtx, board: Board, *, default_lists: bool = True) -> None:
    """Seed a freshly inserted board inside the caller's open `write_tx` (Section 3.10 path 1).

    Inserts the six default unnamed labels and - when `default_lists` - `To Do` / `Doing` /
    `Done`, then records the board's single `board.created` activity at `board_version = 1`. The
    caller inserts the `boards` row and fills `ctx.versions` first, and must not record
    `board.created` itself. Raises no `ApiError` of its own.
    """
    db = ctx.db
    for index, color in enumerate(DEFAULT_LABEL_COLORS, start=1):
        db.add(
            Label(
                board_id=board.id,
                name="",
                color=color,
                tone=_DEFAULT_LABEL_TONE,
                position=STEP * index,
            )
        )
    if default_lists:
        for index, name in enumerate(DEFAULT_LIST_NAMES, start=1):
            db.add(List(board_id=board.id, name=name, position=STEP * index))
    record(ctx, "board.created", board_name=board.name)


def seed_demo(db: Session) -> int:
    """Create the four example boards of Section 3.10, idempotently.

    Each board brings its own colour, its own columns (not the `To Do / Doing / Done` default)
    and the cards of `DEMO_BOARDS`. A board whose name is already taken is left exactly as it is,
    so the command can be run again after a reader has made the fixture their own. Returns how
    many boards it created.
    """
    # Imported inside the function on purpose: `services/boards.py` imports `seed_new_board` from
    # this module, so a module-level import of it here would be a cycle.
    from kanban.services import boards as boards_service

    created = 0
    for spec in DEMO_BOARDS:
        if _find_board(db, spec.name) is not None:
            continue
        board = boards_service.create_board(
            db,
            name=spec.name,
            background_type=DEMO_BOARD_BACKGROUND_TYPE,
            background_value=BOARD_COLORS[spec.color],
            default_lists=False,
        )
        _seed_board(db, board_id=board["id"], spec=spec)
        created += 1
        logger.info("Seeded the %r example board", spec.name)
    return created


def seed_big(db: Session) -> bool:
    """Create the `--big` performance fixture of Section 3.10, idempotently.

    `BIG_LIST_COUNT` lists of `BIG_CARDS_PER_LIST` cards each, with labels and items
    scattered over the cards from `BIG_RANDOM_SEED`. Every row goes through `services/lists.py`,
    `services/cards.py` and `services/items.py`, so the positions, the `short_id`s and the
    activity trail are the ones a hand-built board has - which is the point of measuring a page
    against it. Returns True when it created the board, False when it was already there.
    """
    # Imported inside the function for the reason `seed_demo` gives: `services/boards.py` imports
    # this module, so a module-level import of a service here would be a cycle.
    from kanban.services import boards as boards_service

    if _find_board(db, BIG_BOARD_NAME) is not None:
        return False
    board = boards_service.create_board(
        db,
        name=BIG_BOARD_NAME,
        background_type=DEMO_BOARD_BACKGROUND_TYPE,
        background_value=BIG_BOARD_BACKGROUND,
        default_lists=False,
    )
    board_id = board["id"]
    _seed_big_cards(db, board_id=board_id)
    logger.info(
        "Seeded %r with %d lists of %d cards", BIG_BOARD_NAME, BIG_LIST_COUNT, BIG_CARDS_PER_LIST
    )
    return True


def _seed_board(db: Session, *, board_id: int, spec: _DemoBoard) -> None:
    """One example board's columns and cards, through the services that own them (3.10)."""
    from kanban.services import cards as cards_service
    from kanban.services import lists as lists_service

    list_ids = {}
    for name in spec.lists:
        row, _version = lists_service.create_list(db, board_id=board_id, name=name, index=None)
        list_ids[name] = row["id"]
    label_ids = _label_ids_by_color(db, board_id=board_id)
    for card in spec.cards:
        created = cards_service.create_card(
            db,
            board_id=board_id,
            list_id=list_ids[card.list_name],
            title=card.title,
            label_ids=[label_ids[color] for color in card.label_colors],
        )
        _seed_card_extras(db, board_id=board_id, card_id=created.items[0]["id"], spec=card)


def _seed_card_extras(db: Session, *, board_id: int, card_id: int, spec: _DemoCard) -> None:
    """Fill in the badge one demo card exists to show, through the service that owns it (3.10).

    The description and the dates are one `update_card` because they are one row; the items are
    their own aggregate.
    """
    from kanban.services import cards as cards_service

    changes: dict[str, Any] = {}
    if spec.description:
        changes["description"] = spec.description
    if spec.due_in_days is not None:
        changes["due_at"] = utcnow_iso(days=spec.due_in_days)
    if changes:
        cards_service.update_card(db, board_id=board_id, card_id=card_id, changes=changes)

    if spec.items:
        _seed_items(
            db,
            board_id=board_id,
            card_id=card_id,
            items=spec.items,
            checked=spec.checked,
        )


def _seed_items(
    db: Session,
    *,
    board_id: int,
    card_id: int,
    items: Sequence[str],
    checked: int,
) -> None:
    """One card's items, ticking the leading `checked` of them (Section 3.10).

    They go in as a single multi-line `create_items` call, which is the same `split_lines` path
    a pasted list takes in the UI (Section 4.6), so the fixture exercises it too.
    """
    from kanban.services import items as items_service

    created = items_service.create_items(
        db,
        board_id=board_id,
        card_id=card_id,
        name="\n".join(items),
        split_lines=True,
    ).items
    for item in created[:checked]:
        items_service.update_item(
            db, board_id=board_id, item_id=item["id"], changes={"is_checked": True}
        )


def _seed_big_cards(db: Session, *, board_id: int) -> None:
    """Fill the `--big` board list by list, one service call per row (Section 3.10)."""
    from kanban.services import cards as cards_service
    from kanban.services import lists as lists_service

    label_ids = list(_label_ids_by_color(db, board_id=board_id).values())
    scatter = random.Random(BIG_RANDOM_SEED)
    for list_index in range(1, BIG_LIST_COUNT + 1):
        row, _version = lists_service.create_list(
            db, board_id=board_id, name=f"List {list_index}", index=None
        )
        for card_index in range(1, BIG_CARDS_PER_LIST + 1):
            created = cards_service.create_card(
                db,
                board_id=board_id,
                list_id=row["id"],
                title=f"Card {list_index}-{card_index}",
                label_ids=scatter.sample(label_ids, scatter.randint(0, _BIG_MAX_LABELS)),
            )
            if scatter.random() >= BIG_ITEMS_SHARE:
                continue
            total = scatter.randint(1, _BIG_MAX_ITEMS)
            _seed_items(
                db,
                board_id=board_id,
                card_id=created.items[0]["id"],
                items=tuple(f"Step {step}" for step in range(1, total + 1)),
                checked=scatter.randint(0, total),
            )


def _label_ids_by_color(db: Session, *, board_id: int) -> dict[str, int]:
    """The board's seeded labels keyed by colour, in `position` order."""
    return {
        color: label_id
        for label_id, color in db.execute(
            select(Label.id, Label.color)
            .where(Label.board_id == board_id)
            .order_by(Label.position, Label.id)
        )
    }


def _find_board(db: Session, name: str) -> Board | None:
    """One of the fixture boards, keyed by name, so a rerun never adds a second one."""
    return db.execute(select(Board).where(Board.name == name)).scalar_one_or_none()
