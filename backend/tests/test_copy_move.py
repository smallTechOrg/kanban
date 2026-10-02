"""The list copy, the cross-board list move and the archived listing (Sections 4.4, 3.6 and 4.3).

Three things are asserted here that no other module can assert:

* what a *copy* is - `kanban/copy.py` duplicating a column: rows of its own rather than shared
  ones, its own `short_id` sequence, and each card arriving whole, with its labels and its items;
* that a cross-board list move is **one transaction spanning both boards** (Section 3.6): every
  card gets a fresh `short_id` on the target, labels are dropped, `list.moved_out` /
  `list.moved_in` are written with each board's own version, and both versions are bumped in the
  same COMMIT;
* that `GET /api/boards/{board_id}/archived` lists the archived rows and only those.

A card has no copy endpoint and never changes board on its own, so the only cross-board write left
is the list one. Every fixture is built through the real API (CLAUDE.md section 6); the move cases
call `services.lists` directly, the way `test_ordering.py` calls `ordering.py`, because they assert
stored columns and per-board activity rows that no response body shows.
"""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from kanban.errors import NotFound
from kanban.models import Activity, Board, Card, CardItem
from kanban.services import lists as lists_service
from tests.conftest import CSRF_HEADERS
from tests.test_cards import create_card, list_ids, session

BoardFactory = Callable[..., dict[str, Any]]

#: A board id no board has, for the 404 every destination check answers with (Section 3.6).
NO_SUCH_BOARD = 9_999_999


# --------------------------------------------------------------------------- reading stored rows


def card_of(card_id: int) -> Any:
    """The stored columns of a card the copy and move contracts are written in terms of."""
    for db in session():
        return db.execute(
            select(
                Card.id,
                Card.board_id,
                Card.list_id,
                Card.short_id,
                Card.title,
                Card.description,
                Card.position,
            ).where(Card.id == card_id)
        ).one()
    raise AssertionError("unreachable")  # pragma: no cover


def version_of(board_id: int) -> int:
    """`boards.version`, read straight from the row so no board payload is needed."""
    for db in session():
        return int(db.execute(select(Board.version).where(Board.id == board_id)).scalar_one())
    raise AssertionError("unreachable")  # pragma: no cover


def types_of(board_id: int) -> list[str]:
    """The activity types recorded on a board, in order."""
    for db in session():
        return [
            row.type
            for row in db.execute(
                select(Activity.type).where(Activity.board_id == board_id).order_by(Activity.id)
            ).all()
        ]
    raise AssertionError("unreachable")  # pragma: no cover


def item_ids_of(card_id: int) -> list[int]:
    """A card's item ids, so a copy can be shown not to share rows with its source."""
    for db in session():
        return sorted(db.execute(select(CardItem.id).where(CardItem.card_id == card_id)).scalars())
    raise AssertionError("unreachable")  # pragma: no cover


# --------------------------------------------------------------------------- building a rich card


def detail(api: TestClient, card_id: int) -> dict[str, Any]:
    """`GET /api/cards/{card_id}`: the `CardDetail` every assertion about children reads."""
    response = api.get(f"/api/cards/{card_id}")
    assert response.status_code == 200, response.text
    return response.json()


def label_ids(api: TestClient, board_id: int) -> list[int]:
    """The six labels every new board is seeded with (Section 4.3)."""
    response = api.get(f"/api/boards/{board_id}/labels")
    assert response.status_code == 200, response.text
    return [label["id"] for label in response.json()["items"]]


def add_items(api: TestClient, card_id: int, names: list[str]) -> None:
    """Items on a card, the first of them ticked, through the item endpoints."""
    for offset, name in enumerate(names):
        created = api.post(f"/api/cards/{card_id}/items", json={"name": name}, headers=CSRF_HEADERS)
        assert created.status_code == 201, created.text
        if offset == 0:
            ticked = api.patch(
                f"/api/card-items/{created.json()['item']['id']}",
                json={"is_checked": True},
                headers=CSRF_HEADERS,
            )
            assert ticked.status_code == 200, ticked.text


def cards_in(api: TestClient, board_id: int, list_id: int) -> list[dict[str, Any]]:
    """The board payload's active cards of one list, in `position` order (Section 4.10.1)."""
    response = api.get(f"/api/boards/{board_id}")
    assert response.status_code == 200, response.text
    return [card for card in response.json()["cards"] if card["list_id"] == list_id]


@pytest.fixture
def lists(board: dict[str, Any]) -> list[int]:
    """The seeded `To Do` / `Doing` / `Done` list ids of the module's board."""
    return list_ids(board["id"])


@pytest.fixture
def other_board(board_factory: BoardFactory) -> dict[str, Any]:
    """A second board, for the cross-board list move."""
    return board_factory("Ops")


# --------------------------------------------------------------------------- the list copy


def copy_list(api: TestClient, list_id: int, **body: Any) -> dict[str, Any]:
    """`POST /api/lists/{list_id}/copy`, asserting the documented 201."""
    response = api.post(f"/api/lists/{list_id}/copy", json=body, headers=CSRF_HEADERS)
    assert response.status_code == 201, response.text
    return response.json()


def test_a_copied_list_brings_every_active_card_whole(
    api: TestClient, board: dict[str, Any], lists: list[int]
) -> None:
    """Duplicating a column copies each card with its labels and its items (Section 4.4)."""
    source = create_card(api, lists[0], "Write plan", label_ids=label_ids(api, board["id"])[:2])[
        "item"
    ]
    add_items(api, source["id"], ["Pick the date", "Draft it"])

    body = copy_list(api, lists[0], name="To Do copy")

    copied_list = body["item"]["id"]
    (copy,) = cards_in(api, board["id"], copied_list)
    assert copy["title"] == "Write plan"
    assert copy["id"] != source["id"]
    assert copy["short_id"] != source["short_id"]  # its own slot in the board's sequence
    assert len(copy["label_ids"]) == 2
    # A half-done card copies as half done: a column copy reproduces the card as it stands.
    assert copy["badges"] == {"description": False, "item_done": 1, "item_total": 2}


def test_a_copied_card_does_not_share_item_rows_with_its_source(
    api: TestClient, board: dict[str, Any], lists: list[int]
) -> None:
    """The copy owns its rows: ticking one must never move the other's badge."""
    source = create_card(api, lists[0], "Write plan")["item"]
    add_items(api, source["id"], ["Pick the date", "Draft it"])

    body = copy_list(api, lists[0], name="Copy")
    (copy,) = cards_in(api, board["id"], body["item"]["id"])

    source_items = item_ids_of(source["id"])
    copy_items = item_ids_of(copy["id"])
    assert len(source_items) == len(copy_items) == 2
    assert set(source_items).isdisjoint(copy_items)


def test_a_copied_list_leaves_archived_cards_behind(
    api: TestClient, board: dict[str, Any], lists: list[int]
) -> None:
    """Only the *active* cards travel, so an archived one is not silently resurrected."""
    create_card(api, lists[0], "Active")
    archived = create_card(api, lists[0], "Archived")["item"]
    assert api.post(f"/api/cards/{archived['id']}/archive", headers=CSRF_HEADERS).status_code == 200

    body = copy_list(api, lists[0], name="Copy")

    titles = [card["title"] for card in cards_in(api, board["id"], body["item"]["id"])]
    assert titles == ["Active"]


# --------------------------------------------------------------------------- the list move


def test_a_cross_board_list_move_takes_its_cards_with_it(
    api: TestClient,
    db: Any,
    board: dict[str, Any],
    lists: list[int],
    other_board: dict[str, Any],
) -> None:
    first = create_card(
        api, lists[0], "Keeps travelling", label_ids=label_ids(api, board["id"])[:1]
    )["item"]
    second = create_card(api, lists[0], "Second")["item"]
    archived = create_card(api, lists[0], "Archived but attached")["item"]
    assert api.post(f"/api/cards/{archived['id']}/archive", headers=CSRF_HEADERS).status_code == 200
    create_card(api, list_ids(other_board["id"])[0], "Already there")  # short_id 1 over there
    source_version, target_version = version_of(board["id"]), version_of(other_board["id"])

    item, _positions, board_version = lists_service.move_list(
        db,
        list_id=lists[0],
        board_id=board["id"],
        index=0,
        to_board_id=other_board["id"],
    )

    assert item["board_id"] == other_board["id"]
    moved = [card_of(card["id"]) for card in (first, second, archived)]
    assert {card.board_id for card in moved} == {other_board["id"]}
    assert sorted(card.short_id for card in moved) == [2, 3, 4]  # the target board's sequence
    assert detail(api, first["id"])["label_ids"] == []  # labels are per board
    assert version_of(board["id"]) == source_version + 1
    assert version_of(other_board["id"]) == target_version + 1
    assert board_version == target_version + 1
    assert types_of(board["id"])[-1] == "list.moved_out"
    assert types_of(other_board["id"])[-1] == "list.moved_in"


def test_a_list_move_to_a_board_that_does_not_exist_is_404(
    api: TestClient, db: Any, board: dict[str, Any], lists: list[int]
) -> None:
    with pytest.raises(NotFound):
        lists_service.move_list(
            db, list_id=lists[0], board_id=board["id"], index=0, to_board_id=NO_SUCH_BOARD
        )

    assert list_ids(board["id"]) == lists  # the transaction never opened


def test_a_list_move_naming_its_own_board_still_reorders(
    api: TestClient, db: Any, board: dict[str, Any], lists: list[int]
) -> None:
    item, _positions, _version = lists_service.move_list(
        db, list_id=lists[2], board_id=board["id"], index=0, to_board_id=board["id"]
    )

    assert item["board_id"] == board["id"]
    assert list_ids(board["id"])[0] == lists[2]
    assert types_of(board["id"])[-1] == "list.moved"


def test_the_list_move_route_carries_a_column_and_its_cards_across_boards(
    api: TestClient, board: dict[str, Any], lists: list[int], other_board: dict[str, Any]
) -> None:
    """The same move over HTTP, which is what `MoveListForm` sends (Section 2.4.3)."""
    card = create_card(api, lists[1], "Travels")["item"]

    response = api.post(
        f"/api/lists/{lists[1]}/move",
        json={"index": 0, "to_board_id": other_board["id"]},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 200, response.text
    assert response.json()["item"]["board_id"] == other_board["id"]
    assert card_of(card["id"]).board_id == other_board["id"]


# --------------------------------------------------------------------------- the archived listing


def archived(api: TestClient, board_id: int, **params: Any) -> dict[str, Any]:
    """`GET /api/boards/{board_id}/archived` (Section 4.3)."""
    response = api.get(f"/api/boards/{board_id}/archived", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_the_archived_listing_returns_archived_cards_and_excludes_active_ones(
    api: TestClient, board: dict[str, Any], lists: list[int]
) -> None:
    active = create_card(api, lists[0], "Still on the board")["item"]
    gone = create_card(api, lists[0], "Archived card")["item"]
    assert api.post(f"/api/cards/{gone['id']}/archive", headers=CSRF_HEADERS).status_code == 200
    in_archived_list = create_card(api, lists[1], "Inside an archived list")["item"]
    assert api.post(f"/api/lists/{lists[1]}/archive", headers=CSRF_HEADERS).status_code == 200

    page = archived(api, board["id"])

    ids = [item["id"] for item in page["items"]]
    assert ids == [gone["id"]]
    assert active["id"] not in ids
    # A card inside an archived list is not archived itself: it comes back with the list (3.7).
    assert in_archived_list["id"] not in ids
    assert page["items"][0]["is_archived"] is True
    assert page["items"][0]["badges"]["item_total"] == 0  # a full CardSummary
    assert page["next_before"] is None


def test_the_archived_listing_returns_archived_lists_for_type_lists(
    api: TestClient, board: dict[str, Any], lists: list[int]
) -> None:
    assert api.post(f"/api/lists/{lists[2]}/archive", headers=CSRF_HEADERS).status_code == 200

    page = archived(api, board["id"], type="lists")

    assert [item["id"] for item in page["items"]] == [lists[2]]
    assert page["items"][0]["is_archived"] is True
    assert page["items"][0]["name"] == "Done"
    assert archived(api, board["id"], type="cards")["items"] == []


def test_the_archived_listing_filters_by_q_and_pages_with_next_before(
    api: TestClient, board: dict[str, Any], lists: list[int]
) -> None:
    ids = []
    for title in ("Alpha report", "Beta report", "Gamma note"):
        card = create_card(api, lists[0], title)["item"]
        assert api.post(f"/api/cards/{card['id']}/archive", headers=CSRF_HEADERS).status_code == 200
        ids.append(card["id"])

    matching = archived(api, board["id"], q="REPORT")
    first = archived(api, board["id"], limit=1)
    second = archived(api, board["id"], limit=1, before=first["next_before"])

    assert [item["title"] for item in matching["items"]] == ["Beta report", "Alpha report"]
    assert [item["id"] for item in first["items"]] == [ids[2]]  # newest first
    assert first["next_before"] == ids[2]
    assert [item["id"] for item in second["items"]] == [ids[1]]


def test_the_archived_listing_needs_a_board_that_exists_and_a_known_type(
    api: TestClient, board: dict[str, Any]
) -> None:
    assert api.get(f"/api/boards/{NO_SUCH_BOARD}/archived").status_code == 404
    unknown = api.get(f"/api/boards/{board['id']}/archived", params={"type": "boards"})
    assert unknown.status_code == 422


# --------------------------------------------------------------------------- what is gone


def test_a_card_has_no_copy_route_and_never_names_a_destination_board(
    api: TestClient, lists: list[int], other_board: dict[str, Any]
) -> None:
    """A card is copied by nothing and moved only within its board (Sections 4.5 and 3.6)."""
    card = create_card(api, lists[0], "Stays put")["item"]

    copy = api.post(
        f"/api/cards/{card['id']}/copy",
        json={"title": "Copy", "to_list_id": lists[1], "index": 0},
        headers=CSRF_HEADERS,
    )
    crossing = api.post(
        f"/api/cards/{card['id']}/move",
        json={"to_list_id": list_ids(other_board["id"])[0], "index": 0},
        headers=CSRF_HEADERS,
    )

    assert copy.status_code == 405  # the route does not exist at all
    # `to_list_id` is validated against the board the route resolved, so another board's list is
    # a 400 rather than a cross-board hand-over.
    assert crossing.status_code == 400, crossing.text
