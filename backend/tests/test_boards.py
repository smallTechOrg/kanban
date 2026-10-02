"""`/api/boards` - grouping, creation, stars and the close/delete state machine.

Everything is driven through the public API (CLAUDE.md section 6): since `board_payload.py`
landed, `GET /api/boards/{board_id}` returns the seeded lists of `default_lists` too, so even
they are asserted from the board document rather than from the `lists` table.
"""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from kanban.constants import BOARD_COLORS, DEFAULT_BOARD_COLOR
from kanban.seed import DEFAULT_LABEL_COLORS, DEFAULT_LIST_NAMES
from tests.conftest import CSRF_HEADERS

BoardFactory = Callable[..., dict[str, Any]]


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


def test_create_returns_a_board_summary_at_version_one(board: dict[str, Any]) -> None:
    assert board["name"] == "Sprint 42"
    assert board["version"] == 1
    assert board["is_closed"] is False
    assert board["background_type"] == "color"
    assert board["background_value"] == DEFAULT_BOARD_COLOR
    assert board["background_thumb_url"] is None


def test_create_seeds_the_six_default_labels(api: TestClient, board: dict[str, Any]) -> None:
    payload = api.get(f"/api/boards/{board['id']}").json()

    assert [label["color"] for label in payload["labels"]] == list(DEFAULT_LABEL_COLORS)
    assert {label["name"] for label in payload["labels"]} == {""}
    assert {label["tone"] for label in payload["labels"]} == {"normal"}
    assert [row["name"] for row in payload["lists"]] == list(DEFAULT_LIST_NAMES)
    assert payload["cards"] == []  # a brand-new board holds no card


def test_create_with_default_lists_seeds_to_do_doing_done(
    api: TestClient, board_factory: BoardFactory
) -> None:
    created = board_factory("With lists", default_lists=True)

    assert [name for name, _ in _lists(api, created["id"])] == list(DEFAULT_LIST_NAMES)
    assert [position for _, position in _lists(api, created["id"])] == [65536.0, 131072.0, 196608.0]


def test_create_without_default_lists_seeds_none(
    api: TestClient, board_factory: BoardFactory
) -> None:
    created = board_factory("No lists", default_lists=False)

    assert _lists(api, created["id"]) == []


def test_create_rejects_a_background_value_that_does_not_match_its_type(
    api: TestClient,
) -> None:
    response = api.post(
        "/api/boards",
        json={"name": "Bad background", "background_type": "color", "background_value": "green"},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_create_requires_a_non_blank_name(api: TestClient) -> None:
    assert api.post("/api/boards", json={"name": "   "}, headers=CSRF_HEADERS).status_code == 422


# --------------------------------------------------------------------------- grouping


def test_the_one_group_is_alphabetical(api: TestClient, board_factory: BoardFactory) -> None:
    """`GET /api/boards` answers with `all` and nothing else: one flat list"""
    zebra = board_factory("Zebra project")
    alpha = board_factory("alpha project")

    groups = _groups(api)

    assert set(groups) == {"all"}  # no `starred`, no `recent`
    ordered = [
        board_id for board_id in _ids(groups["all"]) if board_id in {zebra["id"], alpha["id"]}
    ]
    assert ordered == [alpha["id"], zebra["id"]]  # COLLATE NOCASE, so "alpha" sorts before "Zebra"


def test_a_closed_board_leaves_the_list_and_appears_under_closed(
    api: TestClient, board: dict[str, Any]
) -> None:
    closed = api.post(f"/api/boards/{board['id']}/close", headers=CSRF_HEADERS)

    assert closed.status_code == 200
    assert closed.json()["item"]["is_closed"] is True
    assert closed.json()["board_version"] == closed.json()["item"]["version"]
    assert board["id"] not in _ids(_groups(api)["all"])
    assert board["id"] in _ids(_groups(api, closed=True)["closed"])


# --------------------------------------------------------------------------- patch


def test_patch_renames_a_board_and_bumps_its_version(
    api: TestClient, board: dict[str, Any]
) -> None:
    response = api.patch(
        f"/api/boards/{board['id']}", json={"name": "Sprint 43"}, headers=CSRF_HEADERS
    )

    assert response.status_code == 200
    body = response.json()
    assert body["item"]["name"] == "Sprint 43"
    assert body["board_version"] == board["version"] + 1
    assert body["item"]["version"] == body["board_version"]


def test_patch_accepts_a_gradient_and_rejects_a_lone_background_field(
    api: TestClient, board: dict[str, Any]
) -> None:
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


def test_patch_rejects_an_unknown_background_image(api: TestClient, board: dict[str, Any]) -> None:
    response = api.patch(
        f"/api/boards/{board['id']}", json={"background_image_id": 4242}, headers=CSRF_HEADERS
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


# --------------------------------------------------------------------------- closed boards


def test_a_closed_board_still_reads_but_refuses_a_patch(
    api: TestClient, board: dict[str, Any]
) -> None:
    assert api.post(f"/api/boards/{board['id']}/close", headers=CSRF_HEADERS).status_code == 200

    read = api.get(f"/api/boards/{board['id']}")
    patched = api.patch(
        f"/api/boards/{board['id']}", json={"name": "Renamed"}, headers=CSRF_HEADERS
    )

    assert read.status_code == 200
    assert read.json()["board"]["is_closed"] is True
    assert patched.status_code == 409
    assert patched.json()["error"]["code"] == "conflict"


def test_reopen_puts_the_board_back_in_the_list(api: TestClient, board: dict[str, Any]) -> None:
    assert api.post(f"/api/boards/{board['id']}/close", headers=CSRF_HEADERS).status_code == 200

    reopened = api.post(f"/api/boards/{board['id']}/reopen", headers=CSRF_HEADERS)

    assert reopened.status_code == 200
    assert reopened.json()["item"]["is_closed"] is False
    assert board["id"] in _ids(_groups(api)["all"])
    assert board["id"] not in _ids(_groups(api, closed=True)["closed"])


def test_delete_before_close_is_a_conflict_and_after_it_succeeds(
    api: TestClient, board: dict[str, Any]
) -> None:
    too_early = api.delete(f"/api/boards/{board['id']}", headers=CSRF_HEADERS)
    assert api.post(f"/api/boards/{board['id']}/close", headers=CSRF_HEADERS).status_code == 200
    deleted = api.delete(f"/api/boards/{board['id']}", headers=CSRF_HEADERS)

    assert too_early.status_code == 409
    assert too_early.json()["error"]["code"] == "conflict"
    assert deleted.status_code == 204
    assert api.get(f"/api/boards/{board['id']}").status_code == 404
    assert board["id"] not in _ids(_groups(api, closed=True)["closed"])


# --------------------------------------------------------------------------- unknown boards


def test_a_board_id_that_does_not_exist_is_404_for_a_read_and_a_write(api: TestClient) -> None:
    """`board_access` answers 404 `not_found` before any service runs (Section 6.6)."""
    read = api.get("/api/boards/424242")
    patched = api.patch("/api/boards/424242", json={"name": "Ghost"}, headers=CSRF_HEADERS)

    assert read.status_code == 404
    assert read.json()["error"]["code"] == "not_found"
    assert patched.status_code == 404
    assert patched.json()["error"]["code"] == "not_found"


def test_a_board_id_of_zero_is_rejected_by_the_path_type(api: TestClient) -> None:
    """`PathId` is `int` with `ge=1`, so `/api/boards/0` never reaches the dependency."""
    assert api.get("/api/boards/0").status_code == 422


# ------------------------------------------------------------------- writes outside write_tx


def test_reading_a_board_does_not_bump_its_version(api: TestClient, board: dict[str, Any]) -> None:
    """A read is a read: nothing is recorded on the way through (Section 4.1)."""
    assert board["version"] == 1

    api.get(f"/api/boards/{board['id']}")
    api.get(f"/api/boards/{board['id']}")

    assert _version(api, board["id"]) == 1


def test_the_backgrounds_view_lists_the_presets_and_an_empty_library(
    api: TestClient, board: dict[str, Any]
) -> None:
    response = api.get(f"/api/boards/{board['id']}/backgrounds")

    assert response.status_code == 200
    body = response.json()
    assert {row["key"] for row in body["colors"]} == set(BOARD_COLORS)
    assert body["custom"] == []


@pytest.mark.parametrize("closed", [False, True])
def test_the_listing_holds_one_group_decided_by_closed_state(
    api: TestClient, board_factory: BoardFactory, closed: bool
) -> None:
    created = board_factory("Group membership")
    if closed:
        api.post(f"/api/boards/{created['id']}/close", headers=CSRF_HEADERS)

    groups = _groups(api, closed=closed)

    key = "closed" if closed else "all"
    assert set(groups) == {key}
    assert created["id"] in _ids(groups[key])
