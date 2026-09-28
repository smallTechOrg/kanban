"""`/api/cards/{card_id}/comments`, `/api/comments/{comment_id}` and the card feed (4.5, 4.6).

Everything runs through the public API (CLAUDE.md section 6): the card the comments hang off is
created with the composer, the second and third accounts are registered and added as real board
members, and the feed is only ever read through `GET /api/cards/{card_id}/feed`. The two helpers
this module borrows from `test_cards.py` (`list_ids`, `create_card`) are the ones that module
documents as reading the seeded lists directly, because `GET /api/boards/{board_id}/lists` belongs
to a sibling slice.
"""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from kanban.models import User
from tests.conftest import CSRF_HEADERS
from tests.test_cards import create_card, list_ids, register

BoardFactory = Callable[..., dict[str, Any]]
LoggedIn = tuple[TestClient, User]


# --------------------------------------------------------------------------- helpers


@pytest.fixture
def card(logged_in: LoggedIn, board: dict[str, Any]) -> dict[str, Any]:
    """One card in the seeded `To Do` list, which every comment in this module hangs off."""
    api, _user = logged_in
    return create_card(api, list_ids(board["id"])[0], "Design home page")["item"]


def add_member(api: TestClient, board_id: int, user_id: int, role: str = "member") -> None:
    """Put a registered account on the board through `PUT /api/boards/{id}/members/{user_id}`."""
    response = api.put(
        f"/api/boards/{board_id}/members/{user_id}", json={"role": role}, headers=CSRF_HEADERS
    )
    assert response.status_code == 200, response.text


def comment(api: TestClient, card_id: int, body: str) -> dict[str, Any]:
    """`POST /api/cards/{card_id}/comments`, asserting the documented 201."""
    response = api.post(f"/api/cards/{card_id}/comments", json={"body": body}, headers=CSRF_HEADERS)
    assert response.status_code == 201, response.text
    return response.json()


def delete(api: TestClient, comment_id: int) -> int:
    """`DELETE /api/comments/{comment_id}`, returning the status so each test asserts its own."""
    return api.delete(f"/api/comments/{comment_id}", headers=CSRF_HEADERS).status_code


def feed(api: TestClient, card_id: int, **query: Any) -> dict[str, Any]:
    """`GET /api/cards/{card_id}/feed`, with `details` always sent explicitly (Section 4.5)."""
    response = api.get(f"/api/cards/{card_id}/feed", params={"details": 1, **query})
    assert response.status_code == 200, response.text
    return response.json()


def bodies(page: dict[str, Any]) -> list[str]:
    """The comment bodies of one feed page, in the order the page returns them."""
    return [item["comment"]["body"] for item in page["items"] if item["kind"] == "comment"]


def types(page: dict[str, Any]) -> list[str]:
    """Every entry of a page as `comment` or its activity type, newest first."""
    return [
        "comment" if item["kind"] == "comment" else item["activity"]["type"]
        for item in page["items"]
    ]


# --------------------------------------------------------------------------- create


def test_a_comment_carries_its_author_and_no_edit_stamp(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, user = logged_in

    created = comment(api, card["id"], "Looks good, ship it")

    assert set(created["item"]) == {"id", "card_id", "user", "body", "created_at", "edited_at"}
    assert created["item"]["card_id"] == card["id"]
    assert created["item"]["body"] == "Looks good, ship it"
    assert created["item"]["edited_at"] is None
    assert created["item"]["user"] == {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "initials": user.initials,
        "avatar_color": user.avatar_color,
    }
    # One `write_tx`, so one version bump for the comment (Section 4.1).
    assert (
        created["board_version"] == api.get(f"/api/boards/{board['id']}").json()["board"]["version"]
    )


def test_an_observer_may_comment(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    observer, account = register(api, "observer_comments")
    add_member(api, board["id"], account["id"], role="observer")

    created = comment(observer, card["id"], "From the cheap seats")

    assert created["item"]["user"]["id"] == account["id"]
    assert bodies(feed(api, card["id"])) == ["From the cheap seats"]


def test_an_empty_body_is_422(logged_in: LoggedIn, card: dict[str, Any]) -> None:
    api, _user = logged_in

    response = api.post(
        f"/api/cards/{card['id']}/comments", json={"body": "   "}, headers=CSRF_HEADERS
    )

    assert response.status_code == 422


def test_a_non_member_never_learns_a_card_has_comments(
    logged_in: LoggedIn, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    created = comment(api, card["id"], "Private")
    stranger, _account = register(api, "outsider_comments")

    assert stranger.get(f"/api/cards/{card['id']}/feed").status_code == 404
    assert (
        stranger.post(
            f"/api/cards/{card['id']}/comments", json={"body": "Mine"}, headers=CSRF_HEADERS
        ).status_code
        == 404
    )
    assert (
        stranger.patch(
            f"/api/comments/{created['item']['id']}", json={"body": "Mine"}, headers=CSRF_HEADERS
        ).status_code
        == 404
    )


# --------------------------------------------------------------------------- edit


def test_editing_my_own_comment_stamps_edited_at(logged_in: LoggedIn, card: dict[str, Any]) -> None:
    api, _user = logged_in
    created = comment(api, card["id"], "Ship it")

    response = api.patch(
        f"/api/comments/{created['item']['id']}", json={"body": "Ship it now"}, headers=CSRF_HEADERS
    )

    assert response.status_code == 200
    assert response.json()["item"]["body"] == "Ship it now"
    assert response.json()["item"]["edited_at"] is not None
    assert bodies(feed(api, card["id"])) == ["Ship it now"]
    assert types(feed(api, card["id"])) == ["comment.edited", "comment", "card.created"]


def test_re_saving_an_unchanged_body_is_not_an_edit(
    logged_in: LoggedIn, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    created = comment(api, card["id"], "Ship it")

    response = api.patch(
        f"/api/comments/{created['item']['id']}", json={"body": "Ship it"}, headers=CSRF_HEADERS
    )

    assert response.status_code == 200
    assert response.json()["item"]["edited_at"] is None
    assert types(feed(api, card["id"])) == ["comment", "card.created"]


def test_editing_somebody_elses_comment_is_403(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    other, account = register(api, "editor_comments")
    add_member(api, board["id"], account["id"])
    created = comment(other, card["id"], "Mine")

    # The board admin is refused too: an admin may remove a comment, never rewrite one.
    response = api.patch(
        f"/api/comments/{created['item']['id']}", json={"body": "Yours"}, headers=CSRF_HEADERS
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"
    assert bodies(feed(api, card["id"])) == ["Mine"]


def test_editing_a_comment_that_does_not_exist_is_404(logged_in: LoggedIn) -> None:
    api, _user = logged_in

    assert (
        api.patch("/api/comments/999999", json={"body": "Ghost"}, headers=CSRF_HEADERS).status_code
        == 404
    )


# --------------------------------------------------------------------------- delete


def test_deleting_my_own_comment_leaves_the_feed_coherent(
    logged_in: LoggedIn, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    kept = comment(api, card["id"], "Keep me")
    doomed = comment(api, card["id"], "Delete me")

    assert delete(api, doomed["item"]["id"]) == 204
    page = feed(api, card["id"])
    # The orphaned `comment.added` row is skipped rather than rendered as an empty bubble, and the
    # `comment.deleted` row takes its place among the details (Section 4.5).
    assert types(page) == ["comment.deleted", "comment", "card.created"]
    assert bodies(page) == ["Keep me"]
    assert bodies(feed(api, card["id"], details=0)) == ["Keep me"]
    # The deleted body survives in the activity row's preview, which is all the sentence needs.
    assert page["items"][0]["activity"]["data"]["body_preview"] == "Delete me"
    assert kept["item"]["id"] not in {
        item["activity"]["data"]["comment_id"]
        for item in page["items"]
        if item["kind"] == "activity" and item["activity"]["type"] == "comment.deleted"
    }


def test_a_board_admin_deletes_anybodys_comment(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    other, account = register(api, "deleted_comments")
    add_member(api, board["id"], account["id"])
    created = comment(other, card["id"], "Mine")

    assert delete(api, created["item"]["id"]) == 204
    assert bodies(feed(api, card["id"])) == []


def test_a_plain_member_cannot_delete_somebody_elses_comment(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    author, author_account = register(api, "author_comments")
    meddler, meddler_account = register(api, "meddler_comments")
    add_member(api, board["id"], author_account["id"])
    add_member(api, board["id"], meddler_account["id"])
    created = comment(author, card["id"], "Mine")

    assert delete(meddler, created["item"]["id"]) == 403
    assert bodies(feed(api, card["id"])) == ["Mine"]


def test_a_closed_board_freezes_its_comments(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    created = comment(api, card["id"], "Before the freeze")
    assert api.post(f"/api/boards/{board['id']}/close", headers=CSRF_HEADERS).status_code == 200

    assert (
        api.post(
            f"/api/cards/{card['id']}/comments", json={"body": "After"}, headers=CSRF_HEADERS
        ).status_code
        == 409
    )
    assert (
        api.patch(
            f"/api/comments/{created['item']['id']}", json={"body": "After"}, headers=CSRF_HEADERS
        ).status_code
        == 409
    )
    assert delete(api, created["item"]["id"]) == 409
    # Reads are never refused (Section 4.1).
    assert bodies(feed(api, card["id"])) == ["Before the freeze"]


# --------------------------------------------------------------------------- the feed


def test_the_feed_is_newest_first_and_mixes_comments_with_activities(
    logged_in: LoggedIn, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    comment(api, card["id"], "First")
    api.patch(f"/api/cards/{card['id']}", json={"title": "Renamed"}, headers=CSRF_HEADERS)
    comment(api, card["id"], "Second")

    page = feed(api, card["id"])

    assert types(page) == ["comment", "card.renamed", "comment", "card.created"]
    assert bodies(page) == ["Second", "First"]
    assert page["next_before"] is None


def test_hiding_details_returns_comments_only(logged_in: LoggedIn, card: dict[str, Any]) -> None:
    api, _user = logged_in
    created = comment(api, card["id"], "Only me")
    api.patch(
        f"/api/comments/{created['item']['id']}",
        json={"body": "Only me, edited"},
        headers=CSRF_HEADERS,
    )

    page = feed(api, card["id"], details=0)

    # The filter is the exact type `comment.added`, so the `comment.edited` row stays hidden with
    # the other details rather than leaking through a `comment.` prefix match (Section 4.5).
    assert types(page) == ["comment"]
    assert bodies(page) == ["Only me, edited"]


def test_an_activity_entry_carries_its_actor_type_and_denormalised_data(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, user = logged_in

    entry = feed(api, card["id"])["items"][-1]["activity"]

    assert set(entry) == {
        "id",
        "board_id",
        "card_id",
        "list_id",
        "user",
        "type",
        "data",
        "board_version",
        "created_at",
    }
    assert entry["type"] == "card.created"
    assert entry["board_id"] == board["id"]
    assert entry["card_id"] == card["id"]
    assert entry["user"]["id"] == user.id
    assert entry["data"] == {"card_title": "Design home page", "list_name": "To Do"}


def test_the_feed_pages_by_the_activities_cursor(logged_in: LoggedIn, card: dict[str, Any]) -> None:
    api, _user = logged_in
    for index in range(5):
        comment(api, card["id"], f"Comment {index}")

    first = feed(api, card["id"], limit=2)
    second = feed(api, card["id"], limit=2, before=first["next_before"])
    third = feed(api, card["id"], limit=2, before=second["next_before"])
    last = feed(api, card["id"], limit=2, before=third["next_before"])

    assert bodies(first) == ["Comment 4", "Comment 3"]
    assert bodies(second) == ["Comment 2", "Comment 1"]
    assert bodies(third) == ["Comment 0"]
    # The `card.created` row shares the last page, which is full, so the cursor still advances.
    assert types(third) == ["comment", "card.created"]
    assert last["items"] == []
    assert last["next_before"] is None


def test_a_page_whose_only_row_was_a_deleted_comment_still_advances_the_cursor(
    logged_in: LoggedIn, card: dict[str, Any]
) -> None:
    api, _user = logged_in
    comment(api, card["id"], "Survivor")
    doomed = comment(api, card["id"], "Doomed")
    assert delete(api, doomed["item"]["id"]) == 204

    # Newest first the rows are: comment.deleted, comment.added(Doomed), comment.added(Survivor),
    # card.created. With comments only, page one reads the two `comment.added` rows and emits one.
    first = feed(api, card["id"], details=0, limit=2)

    assert bodies(first) == ["Survivor"]
    assert first["next_before"] is not None
    assert feed(api, card["id"], details=0, limit=2, before=first["next_before"])["items"] == []


def test_the_feed_rejects_a_limit_outside_the_documented_range(
    logged_in: LoggedIn, card: dict[str, Any]
) -> None:
    api, _user = logged_in

    assert api.get(f"/api/cards/{card['id']}/feed", params={"limit": 0}).status_code == 422
    assert api.get(f"/api/cards/{card['id']}/feed", params={"limit": 201}).status_code == 422


def test_a_comment_lights_up_the_tile_badge(
    logged_in: LoggedIn, board: dict[str, Any], card: dict[str, Any]
) -> None:
    api, _user = logged_in
    comment(api, card["id"], "One")
    comment(api, card["id"], "Two")

    assert api.get(f"/api/cards/{card['id']}").json()["badges"]["comments"] == 2
