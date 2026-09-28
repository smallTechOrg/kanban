"""`PUT`/`DELETE /api/cards/{card_id}/members/{user_id}` and `.../watch` (Sections 4.5 and 4.1).

Everything is driven through the public API (CLAUDE.md section 6) with one exception: the
`activities` rows are read with SQL, because the endpoint that exposes them -
`GET /api/boards/{board_id}/activity` - belongs to the M4b slice, and Section 3.8 makes the row
`type` and its denormalised `data` part of this slice's contract. The two things that must *not*
happen when somebody watches a card - a `boards.version` bump and an activity row - are asserted the
same way, because "no version bump, no activity, no event" is the whole point of the Section 4.1
per-user exemption.

The application is the real one: `main.create_app()` includes `routers/members.py`, so this module
rides the `client` fixture of `conftest.py` like every other API test.
"""

import json
from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import text

from kanban import db as db_module
from kanban.models import User
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


def _add_member(api: TestClient, board_id: int, user_id: int, role: str = "member") -> None:
    """`PUT /api/boards/{board_id}/members/{user_id}`: the M1 share route."""
    response = api.put(
        f"/api/boards/{board_id}/members/{user_id}", json={"role": role}, headers=CSRF_HEADERS
    )
    assert response.status_code == 200, response.text


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


def _card(api: TestClient, card_id: int) -> dict[str, Any]:
    response = api.get(f"/api/cards/{card_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _assign(api: TestClient, card_id: int, user_id: int) -> Any:
    return api.put(f"/api/cards/{card_id}/members/{user_id}", headers=CSRF_HEADERS)


def _unassign(api: TestClient, card_id: int, user_id: int) -> Any:
    return api.delete(f"/api/cards/{card_id}/members/{user_id}", headers=CSRF_HEADERS)


def _watch(api: TestClient, card_id: int) -> Any:
    return api.put(f"/api/cards/{card_id}/watch", headers=CSRF_HEADERS)


def _unwatch(api: TestClient, card_id: int) -> Any:
    return api.delete(f"/api/cards/{card_id}/watch", headers=CSRF_HEADERS)


def _version(api: TestClient, board_id: int) -> int:
    return int(_payload(api, board_id)["board"]["version"])


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


# --------------------------------------------------------------------------- assignment


def test_assigning_twice_is_idempotent_and_writes_one_activity_row(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    """Section 4.5: the array comes back either way; only the activity row is conditional."""
    api, user = logged_in
    card = _create_card(api, board["id"], "Ship it")

    first = _assign(api, card["id"], user.id)
    second = _assign(api, card["id"], user.id)

    assert (first.status_code, second.status_code) == (200, 200)
    assert first.json()["member_ids"] == second.json()["member_ids"] == [user.id]
    # The second call is still one `write_tx`, so the board version moves; only the activity row
    # is conditional (CLAUDE.md section 4).
    assert second.json()["board_version"] == first.json()["board_version"] + 1
    assert _types(board["id"]).count("card.member_added") == 1
    row_type, data = _activity(board["id"])[-1]
    assert row_type == "card.member_added"
    assert data == {
        "card_title": "Ship it",
        "member_id": user.id,
        "member_name": user.full_name,
        "self": True,
    }


def test_unassigning_somebody_the_card_does_not_carry_is_a_no_op(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, user = logged_in
    other, other_user = _register(api, "memberspare")
    _add_member(api, board["id"], other_user["id"])
    card = _create_card(api, board["id"], "Draft the spec")
    assert _assign(api, card["id"], user.id).status_code == 200

    ignored = _unassign(api, card["id"], other_user["id"])
    removed = _unassign(api, card["id"], user.id)
    other.close()

    assert ignored.status_code == 200
    assert ignored.json()["member_ids"] == [user.id]
    assert removed.json()["member_ids"] == []
    assert _types(board["id"]).count("card.member_removed") == 1
    row_type, data = _activity(board["id"])[-1]
    assert row_type == "card.member_removed"
    assert data == {
        "card_title": "Draft the spec",
        "member_id": user.id,
        "member_name": user.full_name,
        "self": True,
    }


def test_assigning_somebody_else_records_self_false_with_their_name(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    """Section 3.8: `member_name` is denormalised so "added Asha Rao" survives a rename."""
    api, user = logged_in
    _other, other_user = _register(api, "memberasha")
    _add_member(api, board["id"], other_user["id"])
    card = _create_card(api, board["id"], "Pair on it")

    assigned = _assign(api, card["id"], other_user["id"])

    assert assigned.status_code == 200
    assert assigned.json()["member_ids"] == sorted([other_user["id"]])
    row_type, data = _activity(board["id"])[-1]
    assert (row_type, data["self"]) == ("card.member_added", False)
    assert (data["member_id"], data["member_name"]) == (other_user["id"], other_user["full_name"])
    assert user.id not in assigned.json()["member_ids"]


def test_assigning_a_user_who_is_not_a_board_member_is_400(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    """Section 4.5: 400 `bad_request`, and nothing is written."""
    api, _user = logged_in
    _outsider, outsider = _register(api, "memberoutsider")
    card = _create_card(api, board["id"], "Cross board")

    refused = _assign(api, card["id"], outsider["id"])
    ignored = _unassign(api, card["id"], outsider["id"])

    assert refused.status_code == 400
    assert refused.json()["error"]["code"] == "bad_request"
    assert refused.json()["error"]["details"] == {"member_ids": [outsider["id"]]}
    assert "card.member_added" not in _types(board["id"])
    # `DELETE` on an association stays idempotent even for a non-member (Section 4.1).
    assert ignored.status_code == 200
    assert ignored.json()["member_ids"] == []


def test_the_board_payload_card_carries_its_member_ids(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, user = logged_in
    _other, other_user = _register(api, "memberpayload")
    _add_member(api, board["id"], other_user["id"])
    card = _create_card(api, board["id"], "Badge me")

    assert _assign(api, card["id"], other_user["id"]).status_code == 200
    assigned = _assign(api, card["id"], user.id)

    expected = sorted([user.id, other_user["id"]])
    assert assigned.json()["member_ids"] == expected
    assert _payload_card(api, board["id"], card["id"])["member_ids"] == expected
    assert _card(api, card["id"])["member_ids"] == expected


def test_a_non_member_never_learns_the_card_exists(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    """Section 4.5: a non-member gets the same 404 as a missing card, for members and for watch."""
    api, user = logged_in
    card = _create_card(api, board["id"], "Private work")
    other, other_user = _register(api, "memberstranger")

    refused = [
        _assign(other, card["id"], other_user["id"]),
        _unassign(other, card["id"], user.id),
        _watch(other, card["id"]),
        _unwatch(other, card["id"]),
        other.get(f"/api/cards/{card['id']}"),
    ]
    other.close()

    assert [response.status_code for response in refused] == [404] * 5
    assert {response.json()["error"]["code"] for response in refused} == {"not_found"}


def test_an_observer_may_watch_but_not_assign(logged_in: LoggedIn, board: dict[str, Any]) -> None:
    """Section 4.5: watching is per-user state, so observer suffices; assigning needs member."""
    api, _user = logged_in
    other, other_user = _register(api, "memberobserver")
    _add_member(api, board["id"], other_user["id"], role="observer")
    card = _create_card(api, board["id"], "Read only")

    watched = _watch(other, card["id"])
    refused = _assign(other, card["id"], other_user["id"])
    other.close()

    assert watched.status_code == 200
    assert watched.json() == {"is_watching": True}
    assert refused.status_code == 403
    assert refused.json()["error"]["code"] == "forbidden"


# --------------------------------------------------------------------------- watching


def test_watch_and_unwatch_flip_the_flag_without_touching_the_board(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    """Section 4.1: the per-user exemption bumps no version and records no activity row."""
    api, _user = logged_in
    card = _create_card(api, board["id"], "Watch me")
    before_version = _version(api, board["id"])
    before_types = _types(board["id"])

    watched = _watch(api, card["id"])
    assert watched.json() == {"is_watching": True}
    assert _card(api, card["id"])["is_watching"] is True
    assert _payload_card(api, board["id"], card["id"])["is_watching"] is True

    unwatched = _unwatch(api, card["id"])
    assert unwatched.json() == {"is_watching": False}
    assert _card(api, card["id"])["is_watching"] is False

    assert (watched.status_code, unwatched.status_code) == (200, 200)
    assert _version(api, board["id"]) == before_version
    assert _types(board["id"]) == before_types
    assert "card.watched" not in before_types and "card.unwatched" not in _types(board["id"])


def test_watching_twice_and_unwatching_twice_are_idempotent(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in
    card = _create_card(api, board["id"], "Idempotent eye")

    assert _watch(api, card["id"]).json() == {"is_watching": True}
    assert _watch(api, card["id"]).json() == {"is_watching": True}
    assert _card(api, card["id"])["is_watching"] is True
    assert _unwatch(api, card["id"]).json() == {"is_watching": False}
    assert _unwatch(api, card["id"]).json() == {"is_watching": False}
    assert _card(api, card["id"])["is_watching"] is False


def test_watching_is_per_user(logged_in: LoggedIn, board: dict[str, Any]) -> None:
    """One reader's eye icon says nothing about another's (Sections 4.5 and 4.10.1)."""
    api, _user = logged_in
    other, other_user = _register(api, "memberwatcher")
    _add_member(api, board["id"], other_user["id"])
    card = _create_card(api, board["id"], "Shared card")

    assert _watch(other, card["id"]).status_code == 200

    assert _card(other, card["id"])["is_watching"] is True
    assert _card(api, card["id"])["is_watching"] is False
    other.close()


def test_a_closed_board_refuses_both_toggles(
    logged_in: LoggedIn, board_factory: BoardFactory
) -> None:
    """Section 4.1 exempts four routes from the closed-board guard; neither of these is one."""
    api, user = logged_in
    closing = board_factory("Closing soon")
    card = _create_card(api, closing["id"], "Last card")
    assert api.post(f"/api/boards/{closing['id']}/close", headers=CSRF_HEADERS).status_code == 200

    refused = [_assign(api, card["id"], user.id), _watch(api, card["id"])]

    assert [response.status_code for response in refused] == [409, 409]
    assert {response.json()["error"]["code"] for response in refused} == {"conflict"}
