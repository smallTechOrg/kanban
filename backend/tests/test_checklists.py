"""`/api/cards/{card_id}/checklists`, `/api/checklists/...` and `/api/checklist-items/...` (4.6).

Everything is driven through the public API (CLAUDE.md section 6): a checklist is created through
its own endpoint, its items are ticked through theirs, and the aggregates are read back from the
board payload of Section 4.10.1 - the same document the tile badges are rendered from - so the
"tick an item, the badge moves" contract of Section 2.5 is asserted end to end rather than from
the row. The two SQL reads are the ones `test_cards.py` documents and exports: the seeded lists
of a fresh board and the stored rows of a table whose only reader is a sibling slice.
"""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from kanban.models import Card, Checklist, ChecklistItem, User
from kanban.ordering import STEP
from tests.conftest import CSRF_HEADERS
from tests.test_cards import archive_list, board_version, create_card, list_ids, register, session

BoardFactory = Callable[..., dict[str, Any]]
LoggedIn = tuple[TestClient, User]


# --------------------------------------------------------------------------- helpers


def add_checklist(api: TestClient, card_id: int, **body: Any) -> dict[str, Any]:
    """`POST /api/cards/{card_id}/checklists`, asserting the documented 201."""
    response = api.post(f"/api/cards/{card_id}/checklists", json=body, headers=CSRF_HEADERS)
    assert response.status_code == 201, response.text
    return response.json()


def add_item(api: TestClient, checklist_id: int, name: str, **body: Any) -> dict[str, Any]:
    """`POST /api/checklists/{checklist_id}/items`, asserting the documented 201."""
    response = api.post(
        f"/api/checklists/{checklist_id}/items",
        json={"name": name, **body},
        headers=CSRF_HEADERS,
    )
    assert response.status_code == 201, response.text
    return response.json()


def patch_item(api: TestClient, item_id: int, **body: Any) -> Any:
    """`PATCH /api/checklist-items/{item_id}` with the partial body of Section 4.6."""
    return api.patch(f"/api/checklist-items/{item_id}", json=body, headers=CSRF_HEADERS)


def patched_item(api: TestClient, item_id: int, **body: Any) -> dict[str, Any]:
    """The same call, asserting the documented 200 and returning the `Mutated` envelope."""
    response = patch_item(api, item_id, **body)
    assert response.status_code == 200, response.text
    return response.json()


def move_item(api: TestClient, item_id: int, to_checklist_id: int, index: int, **body: Any) -> Any:
    """`POST /api/checklist-items/{item_id}/move` with the single move body of Section 4.9."""
    return api.post(
        f"/api/checklist-items/{item_id}/move",
        json={"to_checklist_id": to_checklist_id, "index": index, **body},
        headers=CSRF_HEADERS,
    )


def item_names(api: TestClient, checklist_id: int, card_id: int) -> list[str]:
    """The checklist's item names in the order the card detail payload returns them."""
    response = api.get(f"/api/cards/{card_id}")
    assert response.status_code == 200, response.text
    checklists = {row["id"]: row for row in response.json()["checklists"]}
    return [item["name"] for item in checklists[checklist_id]["items"]]


def stored_items(checklist_id: int) -> list[tuple[int, str, float]]:
    """`(id, name, position)` of a checklist's items in `(position, id)` order."""
    for db in session():
        return [
            (row.id, row.name, row.position)
            for row in db.execute(
                select(ChecklistItem.id, ChecklistItem.name, ChecklistItem.position)
                .where(ChecklistItem.checklist_id == checklist_id)
                .order_by(ChecklistItem.position, ChecklistItem.id)
            ).all()
        ]
    raise AssertionError("unreachable")  # pragma: no cover


def item_count(checklist_id: int) -> int:
    """How many `checklist_items` rows the checklist still has, cascade included."""
    for db in session():
        return len(
            db.execute(
                select(ChecklistItem.id).where(ChecklistItem.checklist_id == checklist_id)
            ).all()
        )
    raise AssertionError("unreachable")  # pragma: no cover


def checklist_exists(checklist_id: int) -> bool:
    for db in session():
        return db.get(Checklist, checklist_id) is not None
    raise AssertionError("unreachable")  # pragma: no cover


def card_titles(list_id: int) -> list[str]:
    """The list's active card titles in `(position, id)` order."""
    for db in session():
        return list(
            db.execute(
                select(Card.title)
                .where(Card.list_id == list_id, Card.is_archived == 0)
                .order_by(Card.position, Card.id)
            ).scalars()
        )
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
def card(logged_in: LoggedIn, todo: int) -> dict[str, Any]:
    """One card in `To Do` to hang checklists off."""
    api, _user = logged_in
    return create_card(api, todo, "Write plan")["item"]


# --------------------------------------------------------------------------- create and copy


def test_create_defaults_the_name_and_appends_within_the_card(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in

    first = add_checklist(api, card["id"])
    second = add_checklist(api, card["id"], name="Launch tasks")

    assert first["item"]["name"] == "Checklist"
    assert first["item"]["items"] == []
    assert [first["item"]["position"], second["item"]["position"]] == [STEP, 2 * STEP]
    assert second["item"]["card_id"] == card["id"]
    assert second["board_version"] == board_version(api, board["id"])
    assert activity_types(board["id"])[-2:] == ["checklist.added", "checklist.added"]


def test_create_copies_the_items_of_another_checklist_unchecked(
    logged_in: LoggedIn, todo: int, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    source = add_checklist(api, card["id"], name="Steps")["item"]
    for name in ("Draft", "Review", "Ship"):
        add_item(api, source["id"], name)
    ticked = stored_items(source["id"])[0][0]
    patched_item(api, ticked, is_checked=True)
    other = create_card(api, todo, "Second card")["item"]

    copy = add_checklist(
        api, other["id"], name="Steps (copy)", copy_from_checklist_id=source["id"]
    )["item"]

    assert [item["name"] for item in copy["items"]] == ["Draft", "Review", "Ship"]
    assert [item["is_checked"] for item in copy["items"]] == [False, False, False]
    assert [item["position"] for item in copy["items"]] == [STEP, 2 * STEP, 3 * STEP]
    # One user action, so one `checklist.added` row and none per copied item (Section 4.6).
    assert activity_types(other["board_id"]).count("checklist.added") == 2


def test_copying_from_a_checklist_on_another_board_is_a_400(
    logged_in: LoggedIn, board_factory: BoardFactory, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    other_board = board_factory("Other board")
    other_card = create_card(api, list_ids(other_board["id"])[0], "Elsewhere")["item"]
    foreign = add_checklist(api, other_card["id"], name="Foreign")["item"]

    response = api.post(
        f"/api/cards/{card['id']}/checklists",
        json={"name": "Steps", "copy_from_checklist_id": foreign["id"]},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "bad_request"
    assert response.json()["error"]["details"]["checklist_id"] == foreign["id"]


def test_copying_from_a_checklist_that_does_not_exist_is_a_400(
    logged_in: LoggedIn, card: dict[str, Any]
) -> None:
    api, _user = logged_in

    response = api.post(
        f"/api/cards/{card['id']}/checklists",
        json={"copy_from_checklist_id": 9_999},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 400, response.text


# --------------------------------------------------------------------------- rename and delete


def test_rename_records_one_activity_row_and_a_no_op_records_none(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"], name="Steps")["item"]

    renamed = api.patch(
        f"/api/checklists/{checklist['id']}", json={"name": "Launch steps"}, headers=CSRF_HEADERS
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["item"]["name"] == "Launch steps"

    again = api.patch(
        f"/api/checklists/{checklist['id']}", json={"name": "Launch steps"}, headers=CSRF_HEADERS
    )
    assert again.status_code == 200, again.text
    assert activity_types(board["id"]).count("checklist.renamed") == 1


def test_rename_refuses_a_null_name_and_an_empty_body(
    logged_in: LoggedIn, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"])["item"]

    nulled = api.patch(
        f"/api/checklists/{checklist['id']}", json={"name": None}, headers=CSRF_HEADERS
    )
    empty = api.patch(f"/api/checklists/{checklist['id']}", json={}, headers=CSRF_HEADERS)

    assert nulled.status_code == 422, nulled.text
    assert empty.status_code == 422, empty.text


def test_delete_cascades_to_the_items(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"], name="Steps")["item"]
    for name in ("Draft", "Review"):
        add_item(api, checklist["id"], name)
    assert item_count(checklist["id"]) == 2

    response = api.delete(f"/api/checklists/{checklist['id']}", headers=CSRF_HEADERS)

    assert response.status_code == 204, response.text
    assert not checklist_exists(checklist["id"])
    assert item_count(checklist["id"]) == 0
    assert activity_types(board["id"])[-1] == "checklist.deleted"
    assert tile_badges(api, board["id"], card["id"]) == {
        "description": False,
        "comments": 0,
        "attachments": 0,
        "checklist_done": 0,
        "checklist_total": 0,
    }


def test_deleting_the_card_removes_its_checklists(
    logged_in: LoggedIn, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"])["item"]
    add_item(api, checklist["id"], "Draft")

    assert api.post(f"/api/cards/{card['id']}/archive", headers=CSRF_HEADERS).status_code == 200
    assert api.delete(f"/api/cards/{card['id']}", headers=CSRF_HEADERS).status_code == 204

    assert not checklist_exists(checklist["id"])
    assert item_count(checklist["id"]) == 0


# --------------------------------------------------------------------------- checklist reorder


def test_move_reorders_the_checklists_of_the_card(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    first = add_checklist(api, card["id"], name="First")["item"]
    second = add_checklist(api, card["id"], name="Second")["item"]

    response = api.post(
        f"/api/checklists/{second['id']}/move", json={"index": 0}, headers=CSRF_HEADERS
    )

    assert response.status_code == 200, response.text
    assert response.json()["item"]["position"] == STEP / 2
    assert response.json()["positions"] == {}
    detail = api.get(f"/api/cards/{card['id']}").json()
    assert [row["id"] for row in detail["checklists"]] == [second["id"], first["id"]]
    assert activity_types(board["id"])[-1] == "checklist.moved"


def test_move_refuses_a_neighbour_on_another_card(
    logged_in: LoggedIn, todo: int, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    mine = add_checklist(api, card["id"], name="Mine")["item"]
    other = create_card(api, todo, "Other")["item"]
    theirs = add_checklist(api, other["id"], name="Theirs")["item"]

    response = api.post(
        f"/api/checklists/{mine['id']}/move",
        json={"index": 0, "prev_id": theirs["id"]},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 400, response.text
    assert response.json()["error"]["details"]["checklist_ids"] == [theirs["id"]]


# --------------------------------------------------------------------------- items


def test_split_lines_creates_one_item_per_non_empty_line_in_order(
    logged_in: LoggedIn, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"], name="Steps")["item"]

    created = add_item(api, checklist["id"], "One\n  Two  \n\nThree", split_lines=True)

    assert [item["name"] for item in created["items"]] == ["One", "Two", "Three"]
    assert [item["position"] for item in created["items"]] == [STEP, 2 * STEP, 3 * STEP]
    # One transaction, so one version bump for the whole paste (Section 4.1).
    assert created["board_version"] == board_version(api, card["board_id"])
    assert item_names(api, checklist["id"], card["id"]) == ["One", "Two", "Three"]


def test_split_lines_at_an_index_keeps_the_pasted_order(
    logged_in: LoggedIn, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"])["item"]
    add_item(api, checklist["id"], "Anchor")

    add_item(api, checklist["id"], "One\nTwo", split_lines=True, index=0)

    assert item_names(api, checklist["id"], card["id"]) == ["One", "Two", "Anchor"]


def test_a_single_item_answers_the_mutated_envelope_and_appends(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"])["item"]
    add_item(api, checklist["id"], "First")

    created = add_item(api, checklist["id"], "Second")

    assert created["item"]["name"] == "Second"
    assert created["item"]["position"] == 2 * STEP
    assert created["item"]["is_checked"] is False
    assert created["item"]["checked_at"] is None
    assert created["item"]["due_at"] is None
    assert created["item"]["assignee_id"] is None
    assert activity_types(board["id"])[-2:] == [
        "checklist.item_added",
        "checklist.item_added",
    ]


def test_ticking_an_item_moves_the_card_badge_counts(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"], name="Steps")["item"]
    items = [add_item(api, checklist["id"], name)["item"] for name in ("Draft", "Review", "Ship")]
    assert tile_badges(api, board["id"], card["id"])["checklist_total"] == 3

    ticked = patched_item(api, items[0]["id"], is_checked=True)

    assert ticked["item"]["is_checked"] is True
    assert ticked["item"]["checked_at"] is not None
    # The patch answers with the card's recomputed badges so the tile never refetches (4.6).
    assert ticked["item"]["badges"]["checklist_done"] == 1
    assert ticked["item"]["badges"]["checklist_total"] == 3
    assert tile_badges(api, board["id"], card["id"])["checklist_done"] == 1

    patched_item(api, items[1]["id"], is_checked=True)
    assert tile_badges(api, board["id"], card["id"]) == {
        "description": False,
        "comments": 0,
        "attachments": 0,
        "checklist_done": 2,
        "checklist_total": 3,
    }

    unticked = patched_item(api, items[0]["id"], is_checked=False)
    assert unticked["item"]["checked_at"] is None
    assert unticked["item"]["badges"]["checklist_done"] == 1
    assert activity_types(board["id"])[-3:] == [
        "checklist.item_checked",
        "checklist.item_checked",
        "checklist.item_unchecked",
    ]


def test_each_patched_field_writes_its_own_activity_type(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, user = logged_in
    checklist = add_checklist(api, card["id"], name="Steps")["item"]
    item = add_item(api, checklist["id"], "Draft")["item"]
    before = len(activity_types(board["id"]))

    patched_item(api, item["id"], name="Draft outline")
    patched_item(api, item["id"], is_checked=True)
    patched_item(api, item["id"], due_at="2026-09-30T12:00:00.000Z")
    patched_item(api, item["id"], assignee_id=user.id)
    patched_item(api, item["id"], assignee_id=None)
    patched_item(api, item["id"], due_at=None)
    patched_item(api, item["id"], is_checked=False)

    assert activity_types(board["id"])[before:] == [
        "checklist.item_renamed",
        "checklist.item_checked",
        "checklist.item_due_set",
        "checklist.item_assigned",
        "checklist.item_unassigned",
        "checklist.item_due_removed",
        "checklist.item_unchecked",
    ]


def test_patching_a_field_to_its_stored_value_records_nothing(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"])["item"]
    item = add_item(api, checklist["id"], "Draft")["item"]
    before = len(activity_types(board["id"]))

    patched_item(api, item["id"], name="Draft", is_checked=False, due_at=None)

    assert activity_types(board["id"])[before:] == []


def test_assigning_a_user_who_is_not_a_board_member_is_a_400(
    logged_in: LoggedIn, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"])["item"]
    item = add_item(api, checklist["id"], "Draft")["item"]
    _outsider_client, outsider = register(api, "chk_outsider")

    response = patch_item(api, item["id"], assignee_id=outsider["id"])

    assert response.status_code == 400, response.text
    assert response.json()["error"]["details"]["assignee_id"] == outsider["id"]


def test_an_empty_patch_body_is_refused(logged_in: LoggedIn, card: dict[str, Any]) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"])["item"]
    item = add_item(api, checklist["id"], "Draft")["item"]

    assert patch_item(api, item["id"]).status_code == 422
    assert patch_item(api, item["id"], is_checked=None).status_code == 422
    assert patch_item(api, item["id"], due_at="tomorrow").status_code == 422


def test_delete_removes_the_item_and_its_badge(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"])["item"]
    item = add_item(api, checklist["id"], "Draft")["item"]

    response = api.delete(f"/api/checklist-items/{item['id']}", headers=CSRF_HEADERS)

    assert response.status_code == 204, response.text
    assert stored_items(checklist["id"]) == []
    assert tile_badges(api, board["id"], card["id"])["checklist_total"] == 0
    assert activity_types(board["id"])[-1] == "checklist.item_deleted"


# --------------------------------------------------------------------------- item move


def test_reordering_items_within_one_checklist(logged_in: LoggedIn, card: dict[str, Any]) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"])["item"]
    items = [add_item(api, checklist["id"], name)["item"] for name in ("A", "B", "C")]

    response = move_item(api, items[2]["id"], checklist["id"], 0)

    assert response.status_code == 200, response.text
    assert response.json()["item"]["position"] == STEP / 2
    assert response.json()["positions"] == {}
    assert item_names(api, checklist["id"], card["id"]) == ["C", "A", "B"]


def test_moving_an_item_between_checklists_on_the_same_card(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    source = add_checklist(api, card["id"], name="Source")["item"]
    target = add_checklist(api, card["id"], name="Target")["item"]
    moved = add_item(api, source["id"], "Draft")["item"]
    add_item(api, target["id"], "Anchor")

    response = move_item(api, moved["id"], target["id"], 1, prev_id=None, next_id=None)

    assert response.status_code == 200, response.text
    assert response.json()["item"]["checklist_id"] == target["id"]
    assert response.json()["item"]["position"] == 2 * STEP
    assert stored_items(source["id"]) == []
    assert item_names(api, target["id"], card["id"]) == ["Anchor", "Draft"]
    assert activity_types(board["id"])[-1] == "checklist.item_moved"


def test_moving_an_item_to_a_checklist_on_another_card_is_a_400(
    logged_in: LoggedIn, todo: int, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    source = add_checklist(api, card["id"], name="Source")["item"]
    item = add_item(api, source["id"], "Draft")["item"]
    other = create_card(api, todo, "Other card")["item"]
    foreign = add_checklist(api, other["id"], name="Foreign")["item"]

    response = move_item(api, item["id"], foreign["id"], 0)

    assert response.status_code == 400, response.text
    assert response.json()["error"]["details"]["checklist_id"] == foreign["id"]
    assert [name for _id, name, _position in stored_items(source["id"])] == ["Draft"]


def test_an_item_may_not_be_its_own_neighbour(logged_in: LoggedIn, card: dict[str, Any]) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"])["item"]
    item = add_item(api, checklist["id"], "Draft")["item"]

    response = move_item(api, item["id"], checklist["id"], 0, prev_id=item["id"])

    assert response.status_code == 400, response.text
    assert response.json()["error"]["details"]["item_id"] == item["id"]


def test_neighbours_take_precedence_over_the_index(
    logged_in: LoggedIn, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"])["item"]
    items = [add_item(api, checklist["id"], name)["item"] for name in ("A", "B", "C")]

    response = move_item(
        api, items[0]["id"], checklist["id"], 0, prev_id=items[1]["id"], next_id=items[2]["id"]
    )

    assert response.status_code == 200, response.text
    assert response.json()["item"]["position"] == 2.5 * STEP
    assert item_names(api, checklist["id"], card["id"]) == ["B", "A", "C"]


# --------------------------------------------------------------------------- convert to card


def test_convert_makes_a_card_in_the_same_list_and_deletes_the_item(
    logged_in: LoggedIn, board: dict[str, Any], todo: int, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"], name="Steps")["item"]
    item = add_item(api, checklist["id"], "Draft the plan")["item"]

    response = api.post(f"/api/checklist-items/{item['id']}/convert", headers=CSRF_HEADERS)

    assert response.status_code == 201, response.text
    created = response.json()["item"]
    assert created["title"] == "Draft the plan"
    assert created["list_id"] == todo
    assert created["board_id"] == board["id"]
    assert created["short_id"] == card["short_id"] + 1
    assert created["position"] == 2 * STEP
    assert card_titles(todo) == ["Write plan", "Draft the plan"]
    assert stored_items(checklist["id"]) == []
    assert activity_types(board["id"])[-1] == "checklist.item_converted"


def test_convert_at_an_index_inserts_the_new_card_there(
    logged_in: LoggedIn, todo: int, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"])["item"]
    item = add_item(api, checklist["id"], "Goes first")["item"]

    response = api.post(
        f"/api/checklist-items/{item['id']}/convert", json={"index": 0}, headers=CSRF_HEADERS
    )

    assert response.status_code == 201, response.text
    assert card_titles(todo) == ["Goes first", "Write plan"]


def test_convert_with_bottom_appends_like_an_absent_index(
    logged_in: LoggedIn, todo: int, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"])["item"]
    item = add_item(api, checklist["id"], "Goes last")["item"]

    response = api.post(
        f"/api/checklist-items/{item['id']}/convert", json={"index": "bottom"}, headers=CSRF_HEADERS
    )

    assert response.status_code == 201, response.text
    assert card_titles(todo) == ["Write plan", "Goes last"]


# --------------------------------------------------------- GET /api/boards/{id}/checklists


def test_board_checklists_lists_every_visible_checklist_with_its_item_count(
    logged_in: LoggedIn, board: dict[str, Any], todo: int, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    zebra = create_card(api, todo, "Zebra card")["item"]
    steps = add_checklist(api, card["id"], name="Steps")["item"]
    add_checklist(api, card["id"], name="More steps")
    add_checklist(api, zebra["id"], name="Zebra list")
    for name in ("Draft", "Review"):
        add_item(api, steps["id"], name)

    response = api.get(f"/api/boards/{board['id']}/checklists")

    assert response.status_code == 200, response.text
    rows = response.json()["items"]
    # Ordered by card title, then by checklist position within the card (Section 4.6).
    assert [(row["card_title"], row["name"], row["item_count"]) for row in rows] == [
        ("Write plan", "Steps", 2),
        ("Write plan", "More steps", 0),
        ("Zebra card", "Zebra list", 0),
    ]
    assert rows[0]["card_id"] == card["id"]
    assert rows[0]["id"] == steps["id"]


def test_board_checklists_hides_archived_cards_and_archived_lists(
    logged_in: LoggedIn, board: dict[str, Any], todo: int, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    add_checklist(api, card["id"], name="Visible")
    archived_card = create_card(api, todo, "Archived card")["item"]
    add_checklist(api, archived_card["id"], name="On an archived card")
    assert (
        api.post(f"/api/cards/{archived_card['id']}/archive", headers=CSRF_HEADERS).status_code
        == 200
    )
    hidden_list = list_ids(board["id"])[1]
    hidden_card = create_card(api, hidden_list, "In an archived list")["item"]
    add_checklist(api, hidden_card["id"], name="In an archived list")
    archive_list(hidden_list)

    rows = api.get(f"/api/boards/{board['id']}/checklists").json()["items"]

    assert [row["name"] for row in rows] == ["Visible"]


def test_an_observer_may_read_the_board_checklists_but_not_write(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"], name="Steps")["item"]
    observer_client, observer = register(api, "chk_observer")
    assert (
        api.put(
            f"/api/boards/{board['id']}/members/{observer['id']}",
            json={"role": "observer"},
            headers=CSRF_HEADERS,
        ).status_code
        == 200
    )
    observer_client.post(
        "/api/auth/login",
        json={"email_or_username": observer["username"], "password": "correct-horse-battery"},
        headers=CSRF_HEADERS,
    )

    assert observer_client.get(f"/api/boards/{board['id']}/checklists").status_code == 200
    refused = observer_client.post(
        f"/api/checklists/{checklist['id']}/items",
        json={"name": "Nope"},
        headers=CSRF_HEADERS,
    )
    assert refused.status_code == 403, refused.text
    assert refused.json()["error"]["code"] == "forbidden"


# --------------------------------------------------------------------------- permissions


def test_a_non_member_gets_404_for_every_route(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"], name="Steps")["item"]
    item = add_item(api, checklist["id"], "Draft")["item"]
    stranger, account = register(api, "chk_stranger")
    stranger.post(
        "/api/auth/login",
        json={"email_or_username": account["username"], "password": "correct-horse-battery"},
        headers=CSRF_HEADERS,
    )

    assert stranger.get(f"/api/boards/{board['id']}/checklists").status_code == 404
    assert (
        stranger.post(
            f"/api/cards/{card['id']}/checklists", json={}, headers=CSRF_HEADERS
        ).status_code
        == 404
    )
    assert (
        stranger.patch(
            f"/api/checklists/{checklist['id']}", json={"name": "Mine now"}, headers=CSRF_HEADERS
        ).status_code
        == 404
    )
    assert (
        stranger.delete(f"/api/checklists/{checklist['id']}", headers=CSRF_HEADERS).status_code
        == 404
    )
    assert (
        stranger.post(
            f"/api/checklists/{checklist['id']}/items", json={"name": "No"}, headers=CSRF_HEADERS
        ).status_code
        == 404
    )
    assert (
        stranger.patch(
            f"/api/checklist-items/{item['id']}", json={"is_checked": True}, headers=CSRF_HEADERS
        ).status_code
        == 404
    )
    assert (
        stranger.delete(f"/api/checklist-items/{item['id']}", headers=CSRF_HEADERS).status_code
        == 404
    )
    assert (
        stranger.post(
            f"/api/checklist-items/{item['id']}/convert", headers=CSRF_HEADERS
        ).status_code
        == 404
    )


def test_a_row_that_does_not_exist_answers_404(logged_in: LoggedIn) -> None:
    api, _user = logged_in

    missing = api.patch("/api/checklists/9999", json={"name": "x"}, headers=CSRF_HEADERS)
    assert missing.status_code == 404, missing.text
    assert (
        api.patch(
            "/api/checklist-items/9999", json={"is_checked": True}, headers=CSRF_HEADERS
        ).status_code
        == 404
    )


def test_every_mutation_is_refused_while_the_board_is_closed(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"], name="Steps")["item"]
    assert api.post(f"/api/boards/{board['id']}/close", headers=CSRF_HEADERS).status_code == 200

    refused = api.post(
        f"/api/checklists/{checklist['id']}/items", json={"name": "Nope"}, headers=CSRF_HEADERS
    )

    assert refused.status_code == 409, refused.text
    assert refused.json()["error"]["message"] == "Board is closed"
    # Reads are never refused (Section 4.1).
    assert api.get(f"/api/boards/{board['id']}/checklists").status_code == 200


def test_a_checklist_survives_a_card_move(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    checklist = add_checklist(api, card["id"], name="Steps")["item"]
    add_item(api, checklist["id"], "Draft")
    doing = list_ids(board["id"])[1]

    moved = api.post(
        f"/api/cards/{card['id']}/move",
        json={"to_list_id": doing, "index": 0},
        headers=CSRF_HEADERS,
    )

    assert moved.status_code == 200, moved.text
    assert moved.json()["item"]["badges"]["checklist_total"] == 1
    rows = api.get(f"/api/boards/{board['id']}/checklists").json()["items"]
    assert [row["name"] for row in rows] == ["Steps"]
