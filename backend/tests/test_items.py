"""`/api/cards/{card_id}/items` and `/api/card-items/...` (Section 4.6).

Everything is driven through the public API (CLAUDE.md section 6): items are added through the
card's own endpoint, ticked through theirs, and the aggregates are read back from the board
payload of Section 4.10.1 - the same document the tile badges are rendered from - so the "tick an
item, the badge moves" contract of Section 2.5 is asserted end to end rather than from the row.
The two SQL reads are the ones `test_cards.py` documents and exports: the seeded lists of a fresh
board and the stored rows of a table whose only reader is a sibling slice.

A card's items hang off the card, so there is no container to create, rename, delete or move an
item between: a move is always a reorder inside one card.
"""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from kanban.models import CardItem
from kanban.ordering import STEP
from tests.conftest import CSRF_HEADERS
from tests.test_cards import board_version, create_card, list_ids, session

BoardFactory = Callable[..., dict[str, Any]]


# --------------------------------------------------------------------------- helpers


def add_item(api: TestClient, card_id: int, name: str, **body: Any) -> dict[str, Any]:
    """`POST /api/cards/{card_id}/items`, asserting the documented 201."""
    response = api.post(
        f"/api/cards/{card_id}/items", json={"name": name, **body}, headers=CSRF_HEADERS
    )
    assert response.status_code == 201, response.text
    return response.json()


def patch_item(api: TestClient, item_id: int, **body: Any) -> Any:
    """`PATCH /api/card-items/{item_id}` with the partial body of Section 4.6."""
    return api.patch(f"/api/card-items/{item_id}", json=body, headers=CSRF_HEADERS)


def patched_item(api: TestClient, item_id: int, **body: Any) -> dict[str, Any]:
    """The same call, asserting the documented 200 and returning the `Mutated` envelope."""
    response = patch_item(api, item_id, **body)
    assert response.status_code == 200, response.text
    return response.json()


def move_item(api: TestClient, item_id: int, index: int, **body: Any) -> Any:
    """`POST /api/card-items/{item_id}/move` with the single move body of Section 4.9."""
    return api.post(
        f"/api/card-items/{item_id}/move", json={"index": index, **body}, headers=CSRF_HEADERS
    )


def item_names(api: TestClient, card_id: int) -> list[str]:
    """The card's item names in the order the card detail payload returns them."""
    response = api.get(f"/api/cards/{card_id}")
    assert response.status_code == 200, response.text
    return [item["name"] for item in response.json()["items"]]


def stored_items(card_id: int) -> list[tuple[int, str, float]]:
    """`(id, name, position)` of a card's items in `(position, id)` order."""
    for db in session():
        return [
            (row.id, row.name, row.position)
            for row in db.execute(
                select(CardItem.id, CardItem.name, CardItem.position)
                .where(CardItem.card_id == card_id)
                .order_by(CardItem.position, CardItem.id)
            ).all()
        ]
    raise AssertionError("unreachable")  # pragma: no cover


def item_count(card_id: int) -> int:
    """How many `card_items` rows the card still has, cascade included."""
    for db in session():
        return len(db.execute(select(CardItem.id).where(CardItem.card_id == card_id)).all())
    raise AssertionError("unreachable")  # pragma: no cover


def activity_types(board_id: int) -> list[str]:
    """Every `activities.type` of the board, oldest first, read in its own short session."""
    for db in session():
        return [
            row.type
            for row in db.execute(
                text("SELECT type FROM activities WHERE board_id = :id ORDER BY id"),
                {"id": board_id},
            )
        ]
    raise AssertionError("unreachable")  # pragma: no cover


def tile_badges(api: TestClient, board_id: int, card_id: int) -> dict[str, Any]:
    """The card's `badges` object as the board payload carries it (Sections 2.5 and 4.10.1)."""
    response = api.get(f"/api/boards/{board_id}")
    assert response.status_code == 200, response.text
    cards = {card["id"]: card for card in response.json()["cards"]}
    return cards[card_id]["badges"]


@pytest.fixture
def todo(board: dict[str, Any]) -> int:
    """The id of the seeded `To Do` list of the module's board."""
    return list_ids(board["id"])[0]


@pytest.fixture
def card(api: TestClient, todo: int) -> dict[str, Any]:
    """One card in `To Do` to hang items off."""
    return create_card(api, todo, "Write plan")["item"]


# --------------------------------------------------------------------------- create


def test_a_single_item_answers_the_mutated_envelope_and_appends(
    api: TestClient, board: dict[str, Any], card: dict[str, Any]
) -> None:
    """One item is `Mutated[CardItemOut]`, and an absent `index` appends (Section 4.6)."""
    add_item(api, card["id"], "First")
    before = board_version(api, board["id"])
    body = add_item(api, card["id"], "Second")

    assert set(body) == {"item", "board_version"}
    assert body["item"]["card_id"] == card["id"]
    assert body["item"]["name"] == "Second"
    assert body["item"]["is_checked"] is False
    assert body["item"]["checked_at"] is None
    assert body["item"]["due_at"] is None
    assert body["board_version"] == before + 1
    assert item_names(api, card["id"]) == ["First", "Second"]


def test_split_lines_creates_one_item_per_non_empty_line_in_order(
    api: TestClient, card: dict[str, Any]
) -> None:
    """Section 4.6's "Add N items": blank lines are dropped and the order survives."""
    body = add_item(api, card["id"], "Buy domain\n\n  Wire DNS  \nShip it", split_lines=True)

    assert [item["name"] for item in body["items"]] == ["Buy domain", "Wire DNS", "Ship it"]
    assert item_names(api, card["id"]) == ["Buy domain", "Wire DNS", "Ship it"]
    # One transaction, so the whole paste is one version bump rather than three.
    assert body["board_version"] == board_version(api, card["board_id"])


def test_split_lines_at_an_index_keeps_the_pasted_order(
    api: TestClient, card: dict[str, Any]
) -> None:
    """An explicit `index` walks forward a slot per line, so the paste reads top to bottom."""
    add_item(api, card["id"], "First")
    add_item(api, card["id"], "Last")

    add_item(api, card["id"], "A\nB", index=1, split_lines=True)

    assert item_names(api, card["id"]) == ["First", "A", "B", "Last"]


def test_an_explicit_index_inserts_rather_than_appends(
    api: TestClient, card: dict[str, Any]
) -> None:
    add_item(api, card["id"], "First")
    add_item(api, card["id"], "Third")

    add_item(api, card["id"], "Second", index=1)

    assert item_names(api, card["id"]) == ["First", "Second", "Third"]


# --------------------------------------------------------------------------- patch


def test_ticking_an_item_moves_the_card_badge_counts(
    api: TestClient, board: dict[str, Any], card: dict[str, Any]
) -> None:
    """Section 4.6: the patch answers with the card's recomputed badges, and the tile agrees."""
    first = add_item(api, card["id"], "Pick the date")["item"]
    add_item(api, card["id"], "Draft it")

    assert tile_badges(api, board["id"], card["id"]) == {
        "description": False,
        "item_done": 0,
        "item_total": 2,
    }

    body = patched_item(api, first["id"], is_checked=True)

    assert body["item"]["is_checked"] is True
    assert body["item"]["checked_at"] is not None
    assert body["item"]["badges"] == {"description": False, "item_done": 1, "item_total": 2}
    assert tile_badges(api, board["id"], card["id"]) == body["item"]["badges"]

    unticked = patched_item(api, first["id"], is_checked=False)
    assert unticked["item"]["checked_at"] is None
    assert unticked["item"]["badges"]["item_done"] == 0


def test_each_patched_field_writes_its_own_activity_type(
    api: TestClient, board: dict[str, Any], card: dict[str, Any]
) -> None:
    """Section 3.8's `item.*` rows, in the order the patches were made."""
    item = add_item(api, card["id"], "Draft")["item"]
    before = len(activity_types(board["id"]))

    patched_item(api, item["id"], name="Draft outline")
    patched_item(api, item["id"], is_checked=True)
    patched_item(api, item["id"], is_checked=False)
    patched_item(api, item["id"], due_at="2026-10-01T15:00:00.000Z")
    patched_item(api, item["id"], due_at=None)

    assert activity_types(board["id"])[before:] == [
        "item.renamed",
        "item.checked",
        "item.unchecked",
        "item.due_set",
        "item.due_removed",
    ]


def test_patching_a_field_to_its_stored_value_records_nothing(
    api: TestClient, board: dict[str, Any], card: dict[str, Any]
) -> None:
    item = add_item(api, card["id"], "Draft")["item"]
    before = len(activity_types(board["id"]))

    patched_item(api, item["id"], name="Draft")
    patched_item(api, item["id"], is_checked=False)

    assert len(activity_types(board["id"])) == before


def test_an_empty_patch_body_is_refused(api: TestClient, card: dict[str, Any]) -> None:
    item = add_item(api, card["id"], "Draft")["item"]

    assert patch_item(api, item["id"]).status_code == 422
    assert patch_item(api, item["id"], name=None).status_code == 422
    assert patch_item(api, item["id"], is_checked=None).status_code == 422


# --------------------------------------------------------------------------- delete


def test_delete_removes_the_item_and_its_badge(
    api: TestClient, board: dict[str, Any], card: dict[str, Any]
) -> None:
    item = add_item(api, card["id"], "Draft")["item"]
    add_item(api, card["id"], "Survivor")

    response = api.delete(f"/api/card-items/{item['id']}", headers=CSRF_HEADERS)

    assert response.status_code == 204
    assert item_names(api, card["id"]) == ["Survivor"]
    assert tile_badges(api, board["id"], card["id"])["item_total"] == 1
    assert "item.deleted" in activity_types(board["id"])


def test_deleting_the_card_removes_its_items(api: TestClient, card: dict[str, Any]) -> None:
    """`ON DELETE CASCADE`: the items go with the card, and the card need not be archived."""
    add_item(api, card["id"], "Draft")
    assert item_count(card["id"]) == 1

    assert api.delete(f"/api/cards/{card['id']}", headers=CSRF_HEADERS).status_code == 204

    assert item_count(card["id"]) == 0


# --------------------------------------------------------------------------- move


def test_reordering_items_within_the_card(api: TestClient, card: dict[str, Any]) -> None:
    add_item(api, card["id"], "A")
    add_item(api, card["id"], "B")
    last = add_item(api, card["id"], "C")["item"]

    response = move_item(api, last["id"], 0)

    assert response.status_code == 200, response.text
    assert item_names(api, card["id"]) == ["C", "A", "B"]


def test_an_item_may_not_be_its_own_neighbour(api: TestClient, card: dict[str, Any]) -> None:
    """The invariant `ordering.check_neighbours` owns for all four move endpoints."""
    first = add_item(api, card["id"], "A")["item"]
    add_item(api, card["id"], "B")

    response = move_item(api, first["id"], 1, prev_id=first["id"])

    assert response.status_code == 400, response.text


def test_neighbours_take_precedence_over_the_index(api: TestClient, card: dict[str, Any]) -> None:
    """Section 4.9: a stale `index` loses to the two ids that surround the row after the move."""
    first = add_item(api, card["id"], "A")["item"]
    second = add_item(api, card["id"], "B")["item"]
    third = add_item(api, card["id"], "C")["item"]

    response = move_item(api, third["id"], 99, prev_id=first["id"], next_id=second["id"])

    assert response.status_code == 200, response.text
    assert item_names(api, card["id"]) == ["A", "C", "B"]


def test_a_move_answers_with_the_authoritative_position(
    api: TestClient, card: dict[str, Any]
) -> None:
    """The client never computes a position: the row it gets back carries the stored one."""
    add_item(api, card["id"], "A")
    second = add_item(api, card["id"], "B")["item"]

    body = move_item(api, second["id"], 0).json()

    stored = {row[0]: row[2] for row in stored_items(card["id"])}
    assert body["item"]["position"] == stored[second["id"]]
    assert body["item"]["position"] < STEP * 2


# --------------------------------------------------------------------------- access


def test_a_row_that_does_not_exist_answers_404_on_every_route(api: TestClient) -> None:
    """A missing item is the same 404 `not_found` a missing board is (`access.item_access`)."""
    missing = 10_000_000
    assert api.get(f"/api/cards/{missing}").status_code == 404
    patched = api.patch(f"/api/card-items/{missing}", json={"name": "x"}, headers=CSRF_HEADERS)
    assert patched.status_code == 404
    assert api.delete(f"/api/card-items/{missing}", headers=CSRF_HEADERS).status_code == 404
    assert (
        api.post(
            f"/api/card-items/{missing}/move", json={"index": 0}, headers=CSRF_HEADERS
        ).status_code
        == 404
    )


def test_every_mutation_is_refused_while_the_board_is_closed(
    api: TestClient, board_factory: BoardFactory
) -> None:
    """The closed-board 409 of Section 4.1, applied by the one dependency that owns it."""
    created = board_factory("Closing soon")
    todo_id = list_ids(created["id"])[0]
    card_id = create_card(api, todo_id, "Write plan")["item"]["id"]
    item_id = add_item(api, card_id, "Draft")["item"]["id"]

    assert api.post(f"/api/boards/{created['id']}/close", headers=CSRF_HEADERS).status_code == 200

    assert (
        api.post(
            f"/api/cards/{card_id}/items", json={"name": "Nope"}, headers=CSRF_HEADERS
        ).status_code
        == 409
    )
    assert patch_item(api, item_id, name="Nope").status_code == 409
    assert api.delete(f"/api/card-items/{item_id}", headers=CSRF_HEADERS).status_code == 409
    assert move_item(api, item_id, 0).status_code == 409


def test_items_survive_a_card_move(api: TestClient, board: dict[str, Any]) -> None:
    """An item belongs to its card, so moving the card between lists changes nothing about it."""
    todo_id, doing_id = list_ids(board["id"])[:2]
    card_id = create_card(api, todo_id, "Travels")["item"]["id"]
    add_item(api, card_id, "Draft")

    response = api.post(
        f"/api/cards/{card_id}/move",
        json={"to_list_id": doing_id, "index": 0},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 200, response.text
    assert item_names(api, card_id) == ["Draft"]
