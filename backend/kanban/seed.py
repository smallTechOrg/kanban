"""Seeding (Section 3.10).

Two paths live here and nowhere else:

1. **Per-board seeding** - `seed_new_board()`, called by `services/boards.py` from inside the
   single `write_tx` that `POST /api/boards` opens. It owns the six default labels, the optional
   `To Do / Doing / Done` lists and the board's one `board.created` activity, so the boards
   service never writes those rows itself.
2. **Demo seeding** - `seed_demo()` (the "Welcome to Kan Ban" fixture behind `kanban seed --demo`,
   which Playwright and the visual-regression screenshots rely on) and `seed_big()` (the 30 x 100
   board behind `kanban seed --big` that the M2 and M5 performance checks measure).

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

#: The `--demo` board. `background_value` is the Section 3.10 `#0079BF`, read from the palette.
DEMO_BOARD_NAME: Final[str] = "Welcome to Kan Ban"
DEMO_BOARD_BACKGROUND_TYPE: Final[str] = "color"
DEMO_BOARD_BACKGROUND: Final[str] = BOARD_COLORS["blue"]


class _DemoChecklist(NamedTuple):
    """The one checklist of the `--demo` fixture: its name, its items and how many are ticked."""

    name: str
    items: tuple[str, ...]
    #: How many of the leading items arrive checked, which is what the `done/total` badge shows.
    checked: int


class _DemoCard(NamedTuple):
    """One card of the `--demo` fixture: which list it lands in and what it carries."""

    list_name: str
    title: str
    #: Keys of `constants.LABEL_COLORS`, resolved to the board's six seeded labels - which are
    #: unnamed, so their colour is the only handle on them.
    label_colors: tuple[str, ...] = ()
    #: The Markdown body behind the description badge (Section 2.5.3).
    description: str = ""
    #: Whole days from now for `due_at`: `1` is Section 3.10's "due date tomorrow" card and `-2`
    #: its overdue one. `None` leaves the card with no dates.
    due_in_days: int | None = None
    checklist: _DemoChecklist | None = None
    #: A `constants.COVER_COLORS` key for the colour cover of Section 3.10's seventh card.
    cover_color: str = ""
    is_template: bool = False


#: The Markdown the first card carries, which is also the board's own instructions.
_DEMO_DESCRIPTION: Final[str] = """\
This board is the **demo fixture**: every card exists to show one badge.

- Drag a card between lists, or drag a whole list by its header
- Click a card to open it, or paste its URL to deep-link straight to it
- `Esc` closes the card again
"""

#: The eight cards of Section 3.10, one per badge the board page has to render. The trailing
#: comment names the badge each one is there for.
DEMO_CARDS: Final[tuple[_DemoCard, ...]] = (
    _DemoCard("To Do", "Read this board first", description=_DEMO_DESCRIPTION),
    _DemoCard("To Do", "Write the launch announcement", due_in_days=1),  # due tomorrow
    _DemoCard("To Do", "Renew the TLS certificate", due_in_days=-2),  # overdue
    _DemoCard(
        "Doing",
        "Plan the launch checklist",
        checklist=_DemoChecklist(
            "Launch tasks",
            (
                "Pick the date",
                "Draft the announcement",
                "Brief support",
                "Schedule the newsletter",
                "Publish the changelog",
            ),
            checked=2,  # a 2/5 checklist
        ),
    ),
    _DemoCard("Doing", "Migrate DNS", label_colors=("red", "green")),  # "Urgent" + green
    _DemoCard("Doing", "Review the new board page"),
    _DemoCard("Done", "Choose the brand photography", cover_color="sky"),
    _DemoCard("Done", "Weekly retro", is_template=True),  # the template card
)

#: The band height Section 2.5.1 paints a tile cover at unless the reader asks for the full one.
DEMO_COVER_SIZE: Final[str] = "normal"

#: The `--big` board of Section 3.10, which the M2 and M5 performance checks load. 30 x 100 is
#: also the board Section 4.10.1 sets the "under 100 ms" payload target against.
BIG_BOARD_NAME: Final[str] = "Performance check"
BIG_BOARD_BACKGROUND: Final[str] = BOARD_COLORS["purple"]
BIG_LIST_COUNT: Final[int] = 30
BIG_CARDS_PER_LIST: Final[int] = 100

#: `--big` scatters labels and checklists over its cards at random; a fixed seed keeps two runs
#: comparable, so a timing difference is a code change rather than a different fixture.
BIG_RANDOM_SEED: Final[int] = 20260926

#: How many of the board's six labels one `--big` card may carry.
_BIG_MAX_LABELS: Final[int] = 2

#: The share of `--big` cards that get a checklist, and how long it may be. Section 3.10 asks for
#: "random checklists"; a checklist on every card would only make the fixture slower to build
#: without making the board it measures any denser than a real one.
BIG_CHECKLIST_SHARE: Final[float] = 0.25
_BIG_MAX_ITEMS: Final[int] = 5
_BIG_CHECKLIST_NAME: Final[str] = "Tasks"


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


def seed_demo(db: Session) -> bool:
    """Create the "Welcome to Kan Ban" fixture of Section 3.10, idempotently.

    The demo board with its `#0079BF` background, its six default labels, its three default lists,
    its star and the eight `DEMO_CARDS` with the badge each one exists to show. Returns True when
    it created the board, False when the fixture was already there.
    """
    # Imported inside the function on purpose: `services/boards.py` imports `seed_new_board` from
    # this module, so a module-level import of it here would be a cycle.
    from kanban.services import boards as boards_service

    if _find_board(db, DEMO_BOARD_NAME) is not None:
        return False
    board = boards_service.create_board(
        db,
        name=DEMO_BOARD_NAME,
        background_type=DEMO_BOARD_BACKGROUND_TYPE,
        background_value=DEMO_BOARD_BACKGROUND,
        default_lists=True,
    )
    board_id = board["id"]
    boards_service.star_board(db, board_id=board_id)
    _seed_cards(db, board_id=board_id)
    logger.info("Seeded the %r demo board", DEMO_BOARD_NAME)
    return True


def seed_big(db: Session) -> bool:
    """Create the `--big` performance fixture of Section 3.10, idempotently.

    `BIG_LIST_COUNT` lists of `BIG_CARDS_PER_LIST` cards each, with labels and checklists
    scattered over the cards from `BIG_RANDOM_SEED`. Every row goes through `services/lists.py`,
    `services/cards.py` and `services/checklists.py`, so the positions, the `short_id`s and the
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


def _seed_cards(db: Session, *, board_id: int) -> None:
    """Append the `DEMO_CARDS` to their lists through `services/cards.py` (Section 3.10)."""
    from kanban.services import cards as cards_service
    from kanban.services import lists as lists_service

    list_ids = {row["name"]: row["id"] for row in lists_service.list_lists(db, board_id=board_id)}
    label_ids = _label_ids_by_color(db, board_id=board_id)
    for card in DEMO_CARDS:
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

    The description, the dates and the template flag are one `update_card` because they are one
    row; the checklist and the cover are their own aggregates.
    """
    from kanban.services import attachments as attachments_service
    from kanban.services import cards as cards_service

    changes: dict[str, Any] = {}
    if spec.description:
        changes["description"] = spec.description
    if spec.due_in_days is not None:
        changes["due_at"] = utcnow_iso(days=spec.due_in_days)
    if spec.is_template:
        changes["is_template"] = True
    if changes:
        cards_service.update_card(db, board_id=board_id, card_id=card_id, changes=changes)

    if spec.checklist is not None:
        _seed_checklist(
            db,
            board_id=board_id,
            card_id=card_id,
            name=spec.checklist.name,
            items=spec.checklist.items,
            checked=spec.checklist.checked,
        )

    if spec.cover_color:
        attachments_service.set_cover(
            db,
            board_id=board_id,
            card_id=card_id,
            kind="color",
            value=spec.cover_color,
            size=DEMO_COVER_SIZE,
        )


def _seed_checklist(
    db: Session,
    *,
    board_id: int,
    card_id: int,
    name: str,
    items: Sequence[str],
    checked: int,
) -> None:
    """One checklist with its items, ticking the leading `checked` of them (Section 3.10).

    The items go in as a single multi-line `create_items` call, which is the same `split_lines`
    path a pasted list takes in the UI (Section 4.6), so the fixture exercises it too.
    """
    from kanban.services import checklists as checklists_service

    checklist = checklists_service.create_checklist(
        db, board_id=board_id, card_id=card_id, name=name
    ).item
    created = checklists_service.create_items(
        db,
        board_id=board_id,
        checklist_id=checklist["id"],
        name="\n".join(items),
        split_lines=True,
    ).items
    for item in created[:checked]:
        checklists_service.update_item(
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
            if scatter.random() >= BIG_CHECKLIST_SHARE:
                continue
            total = scatter.randint(1, _BIG_MAX_ITEMS)
            _seed_checklist(
                db,
                board_id=board_id,
                card_id=created.items[0]["id"],
                name=_BIG_CHECKLIST_NAME,
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
