"""`/api/boards/{board_id}/labels`, `/api/labels/{label_id}` and the card toggles (4.3, 4.5).

Everything is driven through the public API (CLAUDE.md section 6) with one exception: the
`activities` rows are read with SQL, because the endpoint that exposes them -
`GET /api/boards/{board_id}/activity` - belongs to the M4 slice, and Section 3.8 makes the row
`type` and its denormalised `data` part of this slice's contract.

The application is the real one: `main.create_app()` includes `routers/labels.py`, so this module
rides the `client` fixture of `conftest.py` like every other API test.
"""

import json
from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import text

from kanban import db as db_module
from kanban.models import User
from kanban.ordering import STEP
from kanban.seed import DEFAULT_LABEL_COLORS
from tests.conftest import CSRF_HEADERS

BoardFactory = Callable[..., dict[str, Any]]
LoggedIn = tuple[TestClient, User]


# --------------------------------------------------------------------------- helpers


def _register(api: TestClient, username: str) -> tuple[TestClient, dict[str, Any]]:
    """A second user with a session of their own; `TestClient` keeps its own cookie jar."""
    other = TestClient(api.app)
    response = other.post(
        "/api/auth/register",
        json={
            "email": f"{username}@example.com",
            "username": username,
            "full_name": f"{username.title()} Tester",
            "password": "correct-horse-battery",
        },
        headers=CSRF_HEADERS,
    )
    assert response.status_code == 201, response.text
    return other, response.json()


def _labels(api: TestClient, board_id: int) -> list[dict[str, Any]]:
    response = api.get(f"/api/boards/{board_id}/labels")
    assert response.status_code == 200, response.text
    return response.json()["items"]


def _create_label(api: TestClient, board_id: int, **body: Any) -> dict[str, Any]:
    """`POST /api/boards/{board_id}/labels`: the whole `Mutated<LabelOut>` envelope."""
    response = api.post(f"/api/boards/{board_id}/labels", json=body, headers=CSRF_HEADERS)
    assert response.status_code == 201, response.text
    return response.json()


def _payload(api: TestClient, board_id: int) -> dict[str, Any]:
    response = api.get(f"/api/boards/{board_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _create_card(api: TestClient, board_id: int, title: str) -> dict[str, Any]:
    """One card in the board's first list, created through the M2 composer endpoint."""
    list_id = _payload(api, board_id)["lists"][0]["id"]
    response = api.post(f"/api/lists/{list_id}/cards", json={"title": title}, headers=CSRF_HEADERS)
    assert response.status_code == 201, response.text
    return response.json()["item"]


def _payload_card(api: TestClient, board_id: int, card_id: int) -> dict[str, Any]:
    """The card as the board document of Section 4.10.1 carries it."""
    rows = [row for row in _payload(api, board_id)["cards"] if row["id"] == card_id]
    assert rows, "the card is missing from the board payload"
    return rows[0]


def _attach(api: TestClient, card_id: int, label_id: int) -> Any:
    return api.put(f"/api/cards/{card_id}/labels/{label_id}", headers=CSRF_HEADERS)


def _detach(api: TestClient, card_id: int, label_id: int) -> Any:
    return api.delete(f"/api/cards/{card_id}/labels/{label_id}", headers=CSRF_HEADERS)


def _activity(board_id: int) -> list[tuple[str, dict[str, Any]]]:
    """Every `(type, data)` of the board's activity rows, oldest first, in a short session."""
    db = db_module.SessionLocal()
    try:
        rows = db.execute(
            text("SELECT type, data FROM activities WHERE board_id = :id ORDER BY id"),
            {"id": board_id},
        ).all()
        return [(row.type, json.loads(row.data)) for row in rows]
    finally:
        db.rollback()
        db.close()


def _types(board_id: int) -> list[str]:
    return [row_type for row_type, _data in _activity(board_id)]


# --------------------------------------------------------------------------- the palette


def test_a_new_board_carries_the_six_default_labels(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    """Section 3.10: six unnamed `normal` labels at 65536 ... 393216, in palette order."""
    api, _user = logged_in

    items = _labels(api, board["id"])

    assert [row["color"] for row in items] == list(DEFAULT_LABEL_COLORS)
    assert [row["name"] for row in items] == [""] * 6
    assert [row["tone"] for row in items] == ["normal"] * 6
    assert [row["position"] for row in items] == [STEP * n for n in range(1, 7)]
    assert {row["board_id"] for row in items} == {board["id"]}


def test_create_appends_a_label_with_its_name_colour_and_tone(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in

    created = _create_label(api, board["id"], name="Urgent", color="red", tone="bold")
    item = created["item"]

    assert (item["name"], item["color"], item["tone"]) == ("Urgent", "red", "bold")
    assert item["position"] == STEP * 7
    assert created["board_version"] == board["version"] + 1
    assert [row["id"] for row in _labels(api, board["id"])][-1] == item["id"]
    assert _activity(board["id"])[-1] == (
        "label.created",
        {
            "label_id": item["id"],
            "label_name": "Urgent",
            "label_color": "red",
            "label_tone": "bold",
        },
    )


def test_create_defaults_the_name_to_empty_and_the_tone_to_normal(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    """Section 4.3: `color` is the only required field of the body."""
    api, _user = logged_in

    item = _create_label(api, board["id"], color="sky")["item"]

    assert (item["name"], item["tone"]) == ("", "normal")


def test_rename_keeps_the_position_and_records_the_previous_values(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in
    created = _create_label(api, board["id"], name="Hot", color="orange")
    label = created["item"]

    response = api.patch(
        f"/api/labels/{label['id']}", json={"name": "Urgent", "tone": "bold"}, headers=CSRF_HEADERS
    )

    assert response.status_code == 200, response.text
    item = response.json()["item"]
    assert (item["name"], item["color"], item["tone"]) == ("Urgent", "orange", "bold")
    assert item["position"] == label["position"]
    assert response.json()["board_version"] == created["board_version"] + 1
    row_type, data = _activity(board["id"])[-1]
    assert row_type == "label.updated"
    assert data == {
        "label_id": label["id"],
        "label_name": "Urgent",
        "label_color": "orange",
        "label_tone": "bold",
        "from_name": "Hot",
        "from_color": "orange",
        "from_tone": "normal",
    }


def test_a_patch_that_changes_nothing_records_nothing(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in
    label = _create_label(api, board["id"], name="Ops", color="lime")["item"]

    response = api.patch(
        f"/api/labels/{label['id']}",
        json={"name": "Ops", "color": "lime", "tone": "normal"},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 200, response.text
    assert "label.updated" not in _types(board["id"])


def test_delete_is_admin_only_while_a_member_may_still_rename(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    """Section 4.3 / Appendix B: the admin-only delete is the deviation from Trello."""
    api, _user = logged_in
    other, other_user = _register(api, "labelmember")
    assert (
        api.put(
            f"/api/boards/{board['id']}/members/{other_user['id']}",
            json={"role": "member"},
            headers=CSRF_HEADERS,
        ).status_code
        == 200
    )
    label = _create_label(api, board["id"], name="Ops", color="lime")["item"]

    renamed = other.patch(
        f"/api/labels/{label['id']}", json={"name": "Ops v2"}, headers=CSRF_HEADERS
    )
    refused = other.delete(f"/api/labels/{label['id']}", headers=CSRF_HEADERS)
    deleted = api.delete(f"/api/labels/{label['id']}", headers=CSRF_HEADERS)

    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["item"]["name"] == "Ops v2"
    assert refused.status_code == 403
    assert refused.json()["error"]["code"] == "forbidden"
    assert deleted.status_code == 204
    assert label["id"] not in [row["id"] for row in _labels(api, board["id"])]


def test_delete_removes_the_label_from_every_card(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in
    label = _create_label(api, board["id"], name="Blocked", color="black")["item"]
    card = _create_card(api, board["id"], "Write the plan")
    assert _attach(api, card["id"], label["id"]).json()["label_ids"] == [label["id"]]

    assert api.delete(f"/api/labels/{label['id']}", headers=CSRF_HEADERS).status_code == 204

    assert _payload_card(api, board["id"], card["id"])["label_ids"] == []
    row_type, data = _activity(board["id"])[-1]
    assert row_type == "label.deleted"
    assert data["card_count"] == 1
    assert data["label_name"] == "Blocked"


def test_a_colour_or_tone_outside_the_palette_is_422(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in
    label = _labels(api, board["id"])[0]

    created = api.post(
        f"/api/boards/{board['id']}/labels", json={"color": "turquoise"}, headers=CSRF_HEADERS
    )
    toned = api.post(
        f"/api/boards/{board['id']}/labels",
        json={"color": "green", "tone": "loud"},
        headers=CSRF_HEADERS,
    )
    colourless = api.post(f"/api/boards/{board['id']}/labels", json={}, headers=CSRF_HEADERS)
    patched = api.patch(
        f"/api/labels/{label['id']}", json={"color": "turquoise"}, headers=CSRF_HEADERS
    )
    nulled = api.patch(f"/api/labels/{label['id']}", json={"name": None}, headers=CSRF_HEADERS)

    refused = (created, toned, colourless, patched, nulled)
    assert {response.status_code for response in refused} == {422}
    assert created.json()["error"]["code"] == "validation_error"
    assert "label.created" not in _types(board["id"])


def test_an_unknown_label_id_is_404(logged_in: LoggedIn, board: dict[str, Any]) -> None:
    """The `/api/labels/{label_id}` dependency answers like `auth.list_access` (Section 4.1)."""
    api, _user = logged_in

    patched = api.patch("/api/labels/424242", json={"name": "Ghost"}, headers=CSRF_HEADERS)
    deleted = api.delete("/api/labels/424242", headers=CSRF_HEADERS)

    assert patched.status_code == 404
    assert patched.json()["error"]["code"] == "not_found"
    assert deleted.status_code == 404


def test_a_non_member_never_learns_the_labels_exist(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in
    other, _other_user = _register(api, "labeloutsider")
    label = _labels(api, board["id"])[0]
    card = _create_card(api, board["id"], "Private work")

    read = other.get(f"/api/boards/{board['id']}/labels")
    created = other.post(
        f"/api/boards/{board['id']}/labels", json={"color": "red"}, headers=CSRF_HEADERS
    )
    patched = other.patch(f"/api/labels/{label['id']}", json={"name": "Nope"}, headers=CSRF_HEADERS)
    deleted = other.delete(f"/api/labels/{label['id']}", headers=CSRF_HEADERS)
    attached = _attach(other, card["id"], label["id"])

    answers = (read, created, patched, deleted, attached)
    assert {response.status_code for response in answers} == {404}
    assert read.json()["error"]["code"] == "not_found"


# --------------------------------------------------------------------------- the card toggles


def test_attaching_twice_is_idempotent_and_writes_one_activity_row(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in
    label = _labels(api, board["id"])[0]
    card = _create_card(api, board["id"], "Ship it")

    first = _attach(api, card["id"], label["id"])
    second = _attach(api, card["id"], label["id"])

    assert (first.status_code, second.status_code) == (200, 200)
    assert first.json()["label_ids"] == second.json()["label_ids"] == [label["id"]]
    # The second call is still one `write_tx`, so the board version moves; only the activity row
    # is conditional (CLAUDE.md section 4).
    assert second.json()["board_version"] == first.json()["board_version"] + 1
    assert _types(board["id"]).count("card.label_added") == 1
    row_type, data = _activity(board["id"])[-1]
    assert row_type == "card.label_added"
    assert data == {
        "card_title": "Ship it",
        "label_id": label["id"],
        "label_name": "",
        "label_color": label["color"],
    }


def test_detaching_a_label_that_is_not_attached_is_a_no_op(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in
    green, yellow = _labels(api, board["id"])[:2]
    card = _create_card(api, board["id"], "Draft the spec")
    assert _attach(api, card["id"], green["id"]).status_code == 200

    ignored = _detach(api, card["id"], yellow["id"])
    removed = _detach(api, card["id"], green["id"])

    assert ignored.status_code == 200
    assert ignored.json()["label_ids"] == [green["id"]]
    assert removed.json()["label_ids"] == []
    assert _types(board["id"]).count("card.label_removed") == 1
    row_type, data = _activity(board["id"])[-1]
    assert row_type == "card.label_removed"
    assert (data["card_title"], data["label_id"]) == ("Draft the spec", green["id"])


def test_the_board_payload_card_carries_its_label_ids_in_position_order(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in
    items = _labels(api, board["id"])
    green, purple = items[0], items[4]
    card = _create_card(api, board["id"], "Badge me")

    assert _attach(api, card["id"], purple["id"]).status_code == 200
    attached = _attach(api, card["id"], green["id"])

    assert attached.json()["label_ids"] == [green["id"], purple["id"]]
    assert _payload_card(api, board["id"], card["id"])["label_ids"] == [
        green["id"],
        purple["id"],
    ]


def test_a_label_of_another_board_cannot_be_attached(
    logged_in: LoggedIn, board: dict[str, Any], board_factory: BoardFactory
) -> None:
    api, _user = logged_in
    foreign = _labels(api, board_factory("Other board")["id"])[0]
    card = _create_card(api, board["id"], "Cross board")

    refused = _attach(api, card["id"], foreign["id"])
    ignored = _detach(api, card["id"], foreign["id"])

    assert refused.status_code == 400
    assert refused.json()["error"]["code"] == "bad_request"
    assert ignored.status_code == 200
    assert ignored.json()["label_ids"] == []
