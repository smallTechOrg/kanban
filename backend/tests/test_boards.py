"""`/api/boards` - grouping, creation, stars, the close/delete state machine and members.

Everything is driven through the public API (CLAUDE.md section 6): since `board_payload.py`
landed, `GET /api/boards/{board_id}` returns the seeded lists of `default_lists` too, so even
they are asserted from the board document rather than from the `lists` table.
"""

import time
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from kanban.constants import BOARD_COLORS, DEFAULT_BOARD_COLOR
from kanban.models import User
from kanban.seed import DEFAULT_LABEL_COLORS, DEFAULT_LIST_NAMES
from tests.conftest import CSRF_HEADERS

BoardFactory = Callable[..., dict[str, Any]]
LoggedIn = tuple[TestClient, User]


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


def _wait_for_the_next_millisecond() -> None:
    """Busy-wait until the wall clock's millisecond advances (see the caller for why)."""
    start = time.time()
    while int(time.time() * 1000) == int(start * 1000):
        pass


def _groups(api: TestClient, *, closed: bool = False) -> dict[str, list[dict[str, Any]]]:
    response = api.get("/api/boards", params={"closed": int(closed)})
    assert response.status_code == 200, response.text
    return response.json()


def _ids(boards: list[dict[str, Any]]) -> list[int]:
    return [board["id"] for board in boards]


def _version(api: TestClient, board_id: int) -> int:
    response = api.get(f"/api/boards/{board_id}")
    assert response.status_code == 200, response.text
    return response.json()["board"]["version"]


def _lists(api: TestClient, board_id: int) -> list[tuple[str, float]]:
    """The board document's `lists` array as (name, position) pairs, in `position` order."""
    response = api.get(f"/api/boards/{board_id}")
    assert response.status_code == 200, response.text
    return [(row["name"], row["position"]) for row in response.json()["lists"]]


# --------------------------------------------------------------------------- create


def test_the_default_labels_are_the_first_six_palette_colours() -> None:
    """Section 3.10 fixes the order; the colours come from `constants.LABEL_COLORS` only."""
    assert DEFAULT_LABEL_COLORS == ("green", "yellow", "orange", "red", "purple", "blue")


def test_create_returns_a_board_summary_with_the_caller_as_admin(board: dict[str, Any]) -> None:
    assert board["name"] == "Sprint 42"
    assert board["my_role"] == "admin"
    assert board["version"] == 1
    assert board["is_closed"] is False
    assert board["is_starred"] is False
    assert board["background_type"] == "color"
    assert board["background_value"] == DEFAULT_BOARD_COLOR
    assert board["background_thumb_url"] is None


def test_create_seeds_the_six_default_labels(logged_in: LoggedIn, board: dict[str, Any]) -> None:
    api, user = logged_in

    payload = api.get(f"/api/boards/{board['id']}").json()

    assert [label["color"] for label in payload["labels"]] == list(DEFAULT_LABEL_COLORS)
    assert {label["name"] for label in payload["labels"]} == {""}
    assert {label["tone"] for label in payload["labels"]} == {"normal"}
    assert [member["id"] for member in payload["members"]] == [user.id]
    assert payload["members"][0]["role"] == "admin"
    assert "email" not in payload["members"][0]
    assert [row["name"] for row in payload["lists"]] == list(DEFAULT_LIST_NAMES)
    assert payload["cards"] == []  # a brand-new board holds no card


def test_create_with_default_lists_seeds_to_do_doing_done(
    logged_in: LoggedIn, board_factory: BoardFactory
) -> None:
    api, _user = logged_in
    created = board_factory("With lists", default_lists=True)

    assert [name for name, _ in _lists(api, created["id"])] == list(DEFAULT_LIST_NAMES)
    assert [position for _, position in _lists(api, created["id"])] == [65536.0, 131072.0, 196608.0]


def test_create_without_default_lists_seeds_none(
    logged_in: LoggedIn, board_factory: BoardFactory
) -> None:
    api, _user = logged_in
    created = board_factory("No lists", default_lists=False)

    assert _lists(api, created["id"]) == []


def test_create_rejects_a_background_value_that_does_not_match_its_type(
    logged_in: LoggedIn,
) -> None:
    api, _user = logged_in

    response = api.post(
        "/api/boards",
        json={"name": "Bad background", "background_type": "color", "background_value": "green"},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_create_requires_a_non_blank_name(logged_in: LoggedIn) -> None:
    api, _user = logged_in

    assert api.post("/api/boards", json={"name": "   "}, headers=CSRF_HEADERS).status_code == 422


# --------------------------------------------------------------------------- grouping


def test_all_is_alphabetical_and_starred_and_recent_start_empty(
    logged_in: LoggedIn, board_factory: BoardFactory
) -> None:
    api, _user = logged_in
    zebra = board_factory("Zebra project")
    alpha = board_factory("alpha project")

    groups = _groups(api)

    ordered = [
        board_id for board_id in _ids(groups["all"]) if board_id in {zebra["id"], alpha["id"]}
    ]
    assert ordered == [alpha["id"], zebra["id"]]  # COLLATE NOCASE, so "alpha" sorts before "Zebra"
    assert zebra["id"] not in _ids(groups["starred"])
    assert zebra["id"] not in _ids(groups["recent"])


def test_starring_moves_a_board_into_the_starred_group(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in

    starred = api.put(f"/api/boards/{board['id']}/star", headers=CSRF_HEADERS)

    assert starred.status_code == 200
    assert starred.json() == {"is_starred": True}
    groups = _groups(api)
    assert board["id"] in _ids(groups["starred"])
    assert board["id"] in _ids(groups["all"])  # a starred board is still in `all`
    assert next(row for row in groups["all"] if row["id"] == board["id"])["is_starred"] is True


def test_unstarring_removes_it_again_and_both_calls_are_idempotent(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in

    assert api.put(f"/api/boards/{board['id']}/star", headers=CSRF_HEADERS).status_code == 200
    assert api.put(f"/api/boards/{board['id']}/star", headers=CSRF_HEADERS).status_code == 200
    unstarred = api.delete(f"/api/boards/{board['id']}/star", headers=CSRF_HEADERS)
    assert api.delete(f"/api/boards/{board['id']}/star", headers=CSRF_HEADERS).status_code == 200

    assert unstarred.json() == {"is_starred": False}
    assert board["id"] not in _ids(_groups(api)["starred"])


def test_reading_a_board_puts_it_in_recently_viewed(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in

    assert api.get(f"/api/boards/{board['id']}").status_code == 200

    assert board["id"] in _ids(_groups(api)["recent"])


def test_recently_viewed_holds_at_most_four_boards(
    logged_in: LoggedIn, board_factory: BoardFactory
) -> None:
    api, _user = logged_in
    viewed = [board_factory(f"Viewed {index}") for index in range(5)]
    for created in viewed:
        assert api.get(f"/api/boards/{created['id']}").status_code == 200
        # `board_views.viewed_at` is `utcnow_iso()`, which is millisecond precision, and
        # "Recently viewed" sorts on nothing else (`services/boards.py` `list_boards`). Two
        # views inside one millisecond are therefore recorded as simultaneous and the stable
        # sort falls back to the SQL order, which is by name. A person cannot open two boards
        # that fast - each view is a navigation and a round trip - but `TestClient` calls in
        # process can, which made this assertion flaky. The wait makes the five views the
        # distinct events the assertions below describe.
        _wait_for_the_next_millisecond()

    recent = _groups(api)["recent"]

    assert len(recent) == 4
    assert viewed[0]["id"] not in _ids(recent)  # the least recently viewed falls off
    assert recent[0]["id"] == viewed[-1]["id"]  # newest first


def test_a_closed_board_leaves_the_groups_and_appears_under_closed(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in
    assert api.put(f"/api/boards/{board['id']}/star", headers=CSRF_HEADERS).status_code == 200

    closed = api.post(f"/api/boards/{board['id']}/close", headers=CSRF_HEADERS)

    assert closed.status_code == 200
    assert closed.json()["item"]["is_closed"] is True
    assert closed.json()["board_version"] == closed.json()["item"]["version"]
    open_groups = _groups(api)
    assert board["id"] not in _ids(open_groups["all"])
    assert board["id"] not in _ids(open_groups["starred"])
    assert board["id"] in _ids(_groups(api, closed=True)["closed"])


# --------------------------------------------------------------------------- patch


def test_patch_renames_a_board_and_bumps_its_version(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in

    response = api.patch(
        f"/api/boards/{board['id']}", json={"name": "Sprint 43"}, headers=CSRF_HEADERS
    )

    assert response.status_code == 200
    body = response.json()
    assert body["item"]["name"] == "Sprint 43"
    assert body["board_version"] == board["version"] + 1
    assert body["item"]["version"] == body["board_version"]


def test_patch_accepts_a_gradient_and_rejects_a_lone_background_field(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in

    accepted = api.patch(
        f"/api/boards/{board['id']}",
        json={"background_type": "gradient", "background_value": "gradient-ocean"},
        headers=CSRF_HEADERS,
    )
    rejected = api.patch(
        f"/api/boards/{board['id']}",
        json={"background_value": BOARD_COLORS["green"]},
        headers=CSRF_HEADERS,
    )

    assert accepted.status_code == 200
    assert accepted.json()["item"]["background_value"] == "gradient-ocean"
    assert rejected.status_code == 422


def test_patch_rejects_an_unknown_background_image(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in

    response = api.patch(
        f"/api/boards/{board['id']}", json={"background_image_id": 4242}, headers=CSRF_HEADERS
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


# --------------------------------------------------------------------------- closed boards


def test_a_closed_board_still_reads_but_refuses_a_patch(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in
    assert api.post(f"/api/boards/{board['id']}/close", headers=CSRF_HEADERS).status_code == 200

    read = api.get(f"/api/boards/{board['id']}")
    patched = api.patch(
        f"/api/boards/{board['id']}", json={"name": "Renamed"}, headers=CSRF_HEADERS
    )

    assert read.status_code == 200
    assert read.json()["board"]["is_closed"] is True
    assert patched.status_code == 409
    assert patched.json()["error"]["code"] == "conflict"


def test_star_and_leaving_are_still_allowed_on_a_closed_board(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in
    other, other_user = _register(api, "closedmember")
    assert (
        api.put(
            f"/api/boards/{board['id']}/members/{other_user['id']}",
            json={"role": "member"},
            headers=CSRF_HEADERS,
        ).status_code
        == 200
    )
    assert api.post(f"/api/boards/{board['id']}/close", headers=CSRF_HEADERS).status_code == 200

    starred = other.put(f"/api/boards/{board['id']}/star", headers=CSRF_HEADERS)
    left = other.delete(
        f"/api/boards/{board['id']}/members/{other_user['id']}", headers=CSRF_HEADERS
    )

    assert starred.status_code == 200
    assert left.status_code == 204
    assert other.get(f"/api/boards/{board['id']}").status_code == 404


def test_reopen_is_200_for_an_admin_and_403_for_a_member(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in
    other, other_user = _register(api, "reopenmember")
    api.put(
        f"/api/boards/{board['id']}/members/{other_user['id']}",
        json={"role": "member"},
        headers=CSRF_HEADERS,
    )
    assert api.post(f"/api/boards/{board['id']}/close", headers=CSRF_HEADERS).status_code == 200

    refused = other.post(f"/api/boards/{board['id']}/reopen", headers=CSRF_HEADERS)
    reopened = api.post(f"/api/boards/{board['id']}/reopen", headers=CSRF_HEADERS)

    assert refused.status_code == 403
    assert refused.json()["error"]["code"] == "forbidden"
    assert reopened.status_code == 200
    assert reopened.json()["item"]["is_closed"] is False
    assert board["id"] in _ids(_groups(api)["all"])


def test_delete_before_close_is_a_conflict_and_after_it_succeeds(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in

    too_early = api.delete(f"/api/boards/{board['id']}", headers=CSRF_HEADERS)
    assert api.post(f"/api/boards/{board['id']}/close", headers=CSRF_HEADERS).status_code == 200
    deleted = api.delete(f"/api/boards/{board['id']}", headers=CSRF_HEADERS)

    assert too_early.status_code == 409
    assert too_early.json()["error"]["code"] == "conflict"
    assert deleted.status_code == 204
    assert api.get(f"/api/boards/{board['id']}").status_code == 404
    assert board["id"] not in _ids(_groups(api, closed=True)["closed"])


# --------------------------------------------------------------------------- membership


def test_a_non_member_gets_404_not_403(logged_in: LoggedIn, board: dict[str, Any]) -> None:
    """Board ids must not be enumerable, so a non-member never learns the board exists (4.1)."""
    api, _user = logged_in
    other, _other_user = _register(api, "outsider")

    read = other.get(f"/api/boards/{board['id']}")
    patched = other.patch(
        f"/api/boards/{board['id']}", json={"name": "Hijacked"}, headers=CSRF_HEADERS
    )

    assert read.status_code == 404
    assert read.json()["error"]["code"] == "not_found"
    assert patched.status_code == 404


def test_adding_a_member_is_idempotent_and_role_changes_are_recorded(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, user = logged_in
    other, other_user = _register(api, "invitee")

    added = api.put(
        f"/api/boards/{board['id']}/members/{other_user['id']}",
        json={"role": "member"},
        headers=CSRF_HEADERS,
    )
    again = api.put(
        f"/api/boards/{board['id']}/members/{other_user['id']}",
        json={"role": "member"},
        headers=CSRF_HEADERS,
    )
    promoted = api.put(
        f"/api/boards/{board['id']}/members/{other_user['id']}",
        json={"role": "admin"},
        headers=CSRF_HEADERS,
    )

    assert added.status_code == 200
    assert added.json()["item"]["role"] == "member"
    assert "email" not in added.json()["item"]
    assert again.status_code == 200  # PUT on an association never 409s (4.1)
    assert promoted.json()["item"]["role"] == "admin"
    members = other.get(f"/api/boards/{board['id']}/members").json()["items"]
    assert {member["id"] for member in members} == {user.id, other_user["id"]}


def test_adding_a_member_who_does_not_exist_is_404(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in

    response = api.put(
        f"/api/boards/{board['id']}/members/424242", json={"role": "member"}, headers=CSRF_HEADERS
    )

    assert response.status_code == 404


def test_the_last_admin_can_be_neither_removed_nor_demoted(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, user = logged_in
    other, other_user = _register(api, "lastadmin")
    api.put(
        f"/api/boards/{board['id']}/members/{other_user['id']}",
        json={"role": "member"},
        headers=CSRF_HEADERS,
    )

    removed = api.delete(f"/api/boards/{board['id']}/members/{user.id}", headers=CSRF_HEADERS)
    demoted = api.put(
        f"/api/boards/{board['id']}/members/{user.id}",
        json={"role": "member"},
        headers=CSRF_HEADERS,
    )

    assert removed.status_code == 409
    assert removed.json()["error"]["code"] == "conflict"
    assert demoted.status_code == 409
    assert api.get(f"/api/boards/{board['id']}").status_code == 200
    assert other.get(f"/api/boards/{board['id']}").status_code == 200


def test_a_member_can_leave_but_cannot_remove_anybody_else(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, user = logged_in
    other, other_user = _register(api, "leaver")
    api.put(
        f"/api/boards/{board['id']}/members/{other_user['id']}",
        json={"role": "member"},
        headers=CSRF_HEADERS,
    )

    refused = other.delete(f"/api/boards/{board['id']}/members/{user.id}", headers=CSRF_HEADERS)
    left = other.delete(
        f"/api/boards/{board['id']}/members/{other_user['id']}", headers=CSRF_HEADERS
    )

    assert refused.status_code == 403
    assert left.status_code == 204
    assert other.get(f"/api/boards/{board['id']}").status_code == 404
    assert [
        member["id"] for member in api.get(f"/api/boards/{board['id']}/members").json()["items"]
    ] == [user.id]


def test_removing_somebody_who_is_not_a_member_is_idempotent(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in
    _other, other_user = _register(api, "neverjoined")
    before = _version(api, board["id"])

    response = api.delete(
        f"/api/boards/{board['id']}/members/{other_user['id']}", headers=CSRF_HEADERS
    )

    assert response.status_code == 204
    assert _version(api, board["id"]) == before  # nothing was written


# --------------------------------------------------------------------------- per-user writes


def test_neither_a_star_nor_a_board_view_bumps_the_board_version(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    """Both are per-user writes outside `write_tx` (Section 4.1): no bump, no activity, no event."""
    api, _user = logged_in
    assert board["version"] == 1

    api.get(f"/api/boards/{board['id']}")  # the board_views upsert
    api.get(f"/api/boards/{board['id']}")
    assert _version(api, board["id"]) == 1

    api.put(f"/api/boards/{board['id']}/star", headers=CSRF_HEADERS)
    assert _version(api, board["id"]) == 1
    api.delete(f"/api/boards/{board['id']}/star", headers=CSRF_HEADERS)
    assert _version(api, board["id"]) == 1


def test_the_backgrounds_view_lists_the_presets_and_an_empty_library(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    api, _user = logged_in

    response = api.get(f"/api/boards/{board['id']}/backgrounds")

    assert response.status_code == 200
    body = response.json()
    assert {row["key"] for row in body["colors"]} == set(BOARD_COLORS)
    assert body["custom"] == []


@pytest.mark.parametrize("closed", [False, True])
def test_the_groups_are_disjoint_by_closed_state(
    logged_in: LoggedIn, board_factory: BoardFactory, closed: bool
) -> None:
    api, _user = logged_in
    created = board_factory("Group membership")
    if closed:
        api.post(f"/api/boards/{created['id']}/close", headers=CSRF_HEADERS)

    groups = _groups(api, closed=closed)

    assert set(groups) == ({"closed"} if closed else {"starred", "recent", "all"})
    key = "closed" if closed else "all"
    assert created["id"] in _ids(groups[key])
