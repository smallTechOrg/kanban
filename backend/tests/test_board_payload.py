"""`GET /api/boards/{board_id}`: the four-statement board document (Sections 4.10.1 and 6.7).

The payload is always read through the API, as every test reads (CLAUDE.md section 6). Its
*contents* cannot always be set up that way: an archived list, an archived card and a 300-card
board have no endpoint that produces them in one step, so those rows are inserted directly here -
the same exception `conftest.py` documents for the infrastructure tests - through the app's own
lock discipline (`unversioned_write`, so `BEGIN IMMEDIATE` and the PRAGMAs behave as in production).
"""

import json
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, insert
from sqlalchemy.orm import Session

from kanban import db as db_module
from kanban.models import (
    Attachment,
    Card,
    CardLabel,
    Checklist,
    ChecklistItem,
    Label,
    List,
)
from kanban.ordering import STEP
from kanban.schemas.boards import BoardOut
from tests.conftest import CSRF_HEADERS

BoardFactory = Callable[..., dict[str, Any]]

#: `BoardPayload` (Section 4.10.1).
PAYLOAD_KEYS = {"board", "labels", "lists", "cards"}

#: `ListOut` (Section 4.4).
LIST_KEYS = {
    "id",
    "board_id",
    "name",
    "position",
    "color",
    "is_archived",
    "created_at",
    "updated_at",
}

#: `CardSummary` (Section 4.5), which carries `client_id` only when the card has one.
CARD_KEYS = {
    "id",
    "board_id",
    "list_id",
    "short_id",
    "title",
    "position",
    "is_archived",
    "is_template",
    "start_at",
    "due_at",
    "due_complete",
    "cover",
    "label_ids",
    "badges",
    "created_at",
    "updated_at",
}

#: `CardSummary.badges` (Section 4.5).
BADGE_KEYS = {"description", "attachments", "checklist_done", "checklist_total"}

#: The dominant colour Pillow stores for an image attachment (Section 2.5.1).
DOMINANT_COLOR = "#3B6EA5"


@contextmanager
def _writer() -> Iterator[Session]:
    """A Session that writes with the app's lock discipline, for rows no M2 route creates."""
    session = db_module.SessionLocal()
    try:
        with db_module.unversioned_write(session):
            yield session
    finally:
        session.close()


def _add_list(
    session: Session, *, board_id: int, name: str, position: float, is_archived: int = 0
) -> int:
    board_list = List(board_id=board_id, name=name, position=position, is_archived=is_archived)
    session.add(board_list)
    session.flush()
    return board_list.id


def _add_card(
    session: Session, *, board_id: int, list_id: int, short_id: int, title: str, **columns: Any
) -> Card:
    card = Card(
        board_id=board_id,
        list_id=list_id,
        short_id=short_id,
        title=title,
        position=columns.pop("position", STEP),
        **columns,
    )
    session.add(card)
    session.flush()
    return card


def _read(api: TestClient, board_id: int) -> dict[str, Any]:
    response = api.get(f"/api/boards/{board_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _titles(payload: dict[str, Any]) -> list[str]:
    return [card["title"] for card in payload["cards"]]


@contextmanager
def _counted_statements() -> Iterator[list[str]]:
    """Every SQL statement the engine executes while the block runs, in order."""
    statements: list[str] = []

    def record(
        _conn: Any, _cursor: Any, statement: str, _params: Any, _context: Any, _many: bool
    ) -> None:
        statements.append(statement)

    event.listen(db_module.engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(db_module.engine, "before_cursor_execute", record)


def test_payload_has_the_four_keys_of_section_4_10_1(
    api: TestClient, board: dict[str, Any]
) -> None:
    payload = _read(api, board["id"])

    assert set(payload) == PAYLOAD_KEYS
    assert payload["board"] == board  # exactly the BoardSummary that created it (Section 4.3)
    assert len(payload["labels"]) == 6
    assert [row["name"] for row in payload["lists"]] == ["To Do", "Doing", "Done"]
    assert payload["cards"] == []


def test_lists_carry_the_listout_shape_in_position_order(
    api: TestClient, board_factory: BoardFactory
) -> None:
    created = board_factory("List shapes", default_lists=True)

    payload = _read(api, created["id"])

    assert [row["position"] for row in payload["lists"]] == [STEP, 2 * STEP, 3 * STEP]
    for row in payload["lists"]:
        assert set(row) == LIST_KEYS
        assert row["board_id"] == created["id"]
        assert row["color"] is None
        assert row["is_archived"] is False


def test_a_bare_card_carries_the_cardsummary_shape_with_empty_badges(
    api: TestClient, board_factory: BoardFactory
) -> None:
    created = board_factory("Bare card", default_lists=False)
    with _writer() as session:
        list_id = _add_list(session, board_id=created["id"], name="To Do", position=STEP)
        _add_card(
            session, board_id=created["id"], list_id=list_id, short_id=1, title="Nothing on me"
        )

    (card,) = _read(api, created["id"])["cards"]

    assert set(card) == CARD_KEYS  # no `client_id`: the card was not created optimistically
    assert card["list_id"] == list_id
    assert card["short_id"] == 1
    assert card["position"] == STEP
    assert card["is_archived"] is False
    assert card["is_template"] is False
    assert card["due_complete"] is False
    assert card["start_at"] is None
    assert card["due_at"] is None
    assert card["cover"] is None
    assert card["label_ids"] == []
    assert card["badges"] == {
        "description": False,
        "attachments": 0,
        "checklist_done": 0,
        "checklist_total": 0,
    }


def test_badges_labels_and_cover_come_from_the_real_tables(
    api: TestClient, board_factory: BoardFactory
) -> None:
    """Every aggregate of Section 4.10.1, counted from the tables the one statement joins."""
    created = board_factory("Fully dressed", default_lists=False)
    labels = _read(api, created["id"])["labels"]

    with _writer() as session:
        list_id = _add_list(session, board_id=created["id"], name="Doing", position=STEP)
        card = _add_card(
            session,
            board_id=created["id"],
            list_id=list_id,
            short_id=7,
            title="Write launch announcement",
            description="## Plan\nSomething to say.",
            start_at="2026-09-20T09:00:00.000Z",
            due_at="2026-09-26T15:00:00.000Z",
            due_complete=1,
            is_template=1,
            client_id="tmp_deadbeef",
        )
        # The newest label sits first in `position` order, so an id-ordered `label_ids` would
        # come out the other way round.
        urgent = Label(
            board_id=created["id"], name="Urgent", color="red", tone="bold", position=STEP / 2
        )
        checklist = Checklist(card_id=card.id, name="Steps", position=STEP)
        cover = Attachment(
            card_id=card.id,
            kind="upload",
            name="hero.jpg",
            url="/uploads/attachments/hero.jpg",
            is_image=1,
            dominant_color=DOMINANT_COLOR,
        )
        session.add_all(
            [
                urgent,
                checklist,
                cover,
                Attachment(
                    card_id=card.id,
                    kind="link",
                    name="spec",
                    url="https://example.test/spec",
                ),
                CardLabel(card_id=card.id, label_id=labels[3]["id"]),
            ]
        )
        session.flush()
        session.add(CardLabel(card_id=card.id, label_id=urgent.id))
        session.add_all(
            [
                ChecklistItem(
                    checklist_id=checklist.id,
                    name=f"Step {index}",
                    position=STEP * index,
                    is_checked=int(index <= 2),
                )
                for index in range(1, 6)
            ]
        )
        cover.thumb_path = f"attachments/{cover.id}/thumb.jpg"
        card.cover_type = "attachment"
        card.cover_value = str(cover.id)
        card.cover_size = "full"
        cover_id = cover.id
        urgent_id = urgent.id

    (summary,) = _read(api, created["id"])["cards"]

    assert summary["client_id"] == "tmp_deadbeef"
    assert summary["board_id"] == created["id"]
    assert summary["short_id"] == 7
    assert summary["start_at"] == "2026-09-20T09:00:00.000Z"
    assert summary["is_template"] is True
    assert summary["due_complete"] is True
    assert summary["due_at"] == "2026-09-26T15:00:00.000Z"
    assert summary["badges"] == {
        "description": True,
        "attachments": 2,
        "checklist_done": 2,
        "checklist_total": 5,
    }
    assert summary["label_ids"] == [urgent_id, labels[3]["id"]]  # board label order
    assert summary["cover"] == {
        "kind": "attachment",
        "value": str(cover_id),
        "size": "full",
        "image_url": f"/uploads/attachments/{cover_id}/thumb.jpg",
        "dominant_color": DOMINANT_COLOR,
    }


def test_a_card_with_one_label_returns_a_one_element_array(
    api: TestClient, board_factory: BoardFactory
) -> None:
    """`GROUP_CONCAT` of one id is that id, which the ordering step must not mangle."""
    created = board_factory("Single ids", default_lists=False)
    labels = _read(api, created["id"])["labels"]
    with _writer() as session:
        list_id = _add_list(session, board_id=created["id"], name="To Do", position=STEP)
        card = _add_card(
            session, board_id=created["id"], list_id=list_id, short_id=1, title="One of each"
        )
        session.add(CardLabel(card_id=card.id, label_id=labels[2]["id"]))

    (summary,) = _read(api, created["id"])["cards"]

    assert summary["label_ids"] == [labels[2]["id"]]


def test_a_colour_cover_carries_no_image(api: TestClient, board_factory: BoardFactory) -> None:
    created = board_factory("Colour cover", default_lists=False)
    with _writer() as session:
        list_id = _add_list(session, board_id=created["id"], name="To Do", position=STEP)
        _add_card(
            session,
            board_id=created["id"],
            list_id=list_id,
            short_id=1,
            title="Sky",
            cover_type="color",
            cover_value="sky",
        )

    (card,) = _read(api, created["id"])["cards"]

    assert card["cover"] == {"kind": "color", "value": "sky", "size": "normal"}


def test_the_rendered_body_is_exactly_what_boardout_would_have_serialised(
    api: TestClient, board_factory: BoardFactory
) -> None:
    """The guard behind `read_board` returning a rendered `JSONResponse` (Section 5.11).

    `BoardOut` is still the route's `response_model` and still the contract; it is enforced here
    rather than on every request, because validating and re-serialising 3,000 `CardSummary`
    models cost 169 ms of the Section 5.11 budget. The round trip catches every way the two
    could drift: a missing or mistyped field fails validation, an extra key or a renamed one
    survives validation but not the comparison, and an optional field serialised as `null`
    rather than left out (`client_id`, `image_url`, `dominant_color`) differs from the body.

    The board is shaped to carry all three optional fields on one side or the other: one card
    was created optimistically and has a `client_id`, one wears a colour cover and so has
    neither image field, and one has no cover at all.
    """
    created = board_factory("Schema contract", default_lists=True)
    with _writer() as session:
        list_id = _add_list(session, board_id=created["id"], name="Backlog", position=4 * STEP)
        _add_card(
            session,
            board_id=created["id"],
            list_id=list_id,
            short_id=1,
            title="Created optimistically",
            client_id="tmp_0123456789abcdef0123456789abcdef",
            description="## Plan",
            start_at="2026-09-20T09:00:00.000Z",
            due_at="2026-09-26T15:00:00.000Z",
            due_complete=1,
        )
        _add_card(
            session,
            board_id=created["id"],
            list_id=list_id,
            short_id=2,
            title="Colour cover",
            position=2 * STEP,
            cover_type="color",
            cover_value="sky",
        )
        _add_card(
            session,
            board_id=created["id"],
            list_id=list_id,
            short_id=3,
            title="Nothing optional",
            position=3 * STEP,
        )

    body = _read(api, created["id"])

    assert len(body["cards"]) == 3
    assert json.loads(BoardOut.model_validate(body).model_dump_json()) == body


def test_badge_counts_and_id_arrays_are_typed_as_section_4_5_declares(
    api: TestClient, board_factory: BoardFactory
) -> None:
    created = board_factory("Types", default_lists=False)
    with _writer() as session:
        list_id = _add_list(session, board_id=created["id"], name="To Do", position=STEP)
        _add_card(session, board_id=created["id"], list_id=list_id, short_id=1, title="Typed")

    (card,) = _read(api, created["id"])["cards"]

    assert set(card["badges"]) == BADGE_KEYS
    assert isinstance(card["badges"]["description"], bool)
    for count in ("attachments", "checklist_done", "checklist_total"):
        assert isinstance(card["badges"][count], int)
        assert not isinstance(card["badges"][count], bool)
    assert isinstance(card["label_ids"], list)
    assert isinstance(card["position"], float)


def test_cards_are_ordered_by_position_then_id(
    api: TestClient, board_factory: BoardFactory
) -> None:
    created = board_factory("Ordering", default_lists=False)
    with _writer() as session:
        list_id = _add_list(session, board_id=created["id"], name="To Do", position=STEP)
        for index, (title, position) in enumerate(
            [("tie first", STEP), ("tie second", STEP), ("lowest", STEP / 2)], start=1
        ):
            _add_card(
                session,
                board_id=created["id"],
                list_id=list_id,
                short_id=index,
                title=title,
                position=position,
            )

    assert _titles(_read(api, created["id"])) == ["lowest", "tie first", "tie second"]


def test_an_archived_list_and_its_cards_are_both_absent(
    api: TestClient, board_factory: BoardFactory
) -> None:
    """Section 4.3: the cards statement joins `lists`, so a hidden list hides its cards."""
    created = board_factory("Archived list", default_lists=False)
    with _writer() as session:
        active = _add_list(session, board_id=created["id"], name="Active", position=STEP)
        archived = _add_list(
            session, board_id=created["id"], name="Archived", position=2 * STEP, is_archived=1
        )
        _add_card(session, board_id=created["id"], list_id=active, short_id=1, title="visible")
        _add_card(session, board_id=created["id"], list_id=archived, short_id=2, title="hidden")

    payload = _read(api, created["id"])

    assert [row["name"] for row in payload["lists"]] == ["Active"]
    assert _titles(payload) == ["visible"]


def test_an_archived_card_is_absent_while_its_list_stays(
    api: TestClient, board_factory: BoardFactory
) -> None:
    created = board_factory("Archived card", default_lists=False)
    with _writer() as session:
        list_id = _add_list(session, board_id=created["id"], name="To Do", position=STEP)
        _add_card(session, board_id=created["id"], list_id=list_id, short_id=1, title="visible")
        _add_card(
            session,
            board_id=created["id"],
            list_id=list_id,
            short_id=2,
            title="archived",
            position=2 * STEP,
            is_archived=1,
        )

    payload = _read(api, created["id"])

    assert [row["name"] for row in payload["lists"]] == ["To Do"]
    assert _titles(payload) == ["visible"]


def test_a_board_that_does_not_exist_is_404(api: TestClient) -> None:
    response = api.get("/api/boards/424242")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_a_closed_board_still_returns_its_payload(
    api: TestClient, board_factory: BoardFactory
) -> None:
    """Section 2.3.5: `ClosedBoardPage` renders from the payload of a closed board."""
    created = board_factory("Closing down", default_lists=False)
    with _writer() as session:
        list_id = _add_list(session, board_id=created["id"], name="To Do", position=STEP)
        _add_card(session, board_id=created["id"], list_id=list_id, short_id=1, title="still here")
    assert api.post(f"/api/boards/{created['id']}/close", headers=CSRF_HEADERS).status_code == 200

    payload = _read(api, created["id"])

    assert payload["board"]["is_closed"] is True
    assert _titles(payload) == ["still here"]


@pytest.fixture
def cards_boards(api: TestClient, board_factory: BoardFactory) -> tuple[int, int]:
    """Two boards of the same shape, one with 3 cards and one with 300, for the N+1 guard."""
    boards: list[int] = []
    for name, card_count in (("Small board", 3), ("Big board", 300)):
        created = board_factory(name, default_lists=False)
        with _writer() as session:
            list_id = _add_list(session, board_id=created["id"], name="To Do", position=STEP)
            session.execute(
                insert(Card),
                [
                    {
                        "board_id": created["id"],
                        "list_id": list_id,
                        "short_id": index,
                        "title": f"Card {index}",
                        "position": STEP * index,
                    }
                    for index in range(1, card_count + 1)
                ],
            )
        boards.append(created["id"])
    return boards[0], boards[1]


def test_the_statement_count_does_not_grow_with_the_number_of_cards(
    api: TestClient, cards_boards: tuple[int, int]
) -> None:
    """Section 4.10.1: four statements, whatever the board holds - the N+1 regression guard."""
    counts: list[int] = []
    for board_id, expected in zip(cards_boards, (3, 300), strict=True):
        _read(api, board_id)  # warm up: the first `board_views` insert happens only once
        with _counted_statements() as statements:
            payload = _read(api, board_id)
        assert len(payload["cards"]) == expected
        assert sum(1 for statement in statements if "FROM cards c" in statement) == 1
        counts.append(len(statements))

    assert counts[0] == counts[1]
