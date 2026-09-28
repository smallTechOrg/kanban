"""`GET /api/boards/{board_id}/activity`: the board activity feed (Sections 4.3, 2.3.4 and 3.8).

Everything is set up through the public API (CLAUDE.md section 6): the rows this module reads were
written by the real endpoints through `activity.record()`, never inserted by hand, which is the
only way a test can prove that the denormalised names of the Section 3.8 table survive a rename or
a deletion. The two helpers borrowed from `test_cards.py` (`list_ids`, `create_card`) and the one
from `test_comments.py` (`add_member`) are the ones those modules already document as shared.
"""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from kanban.models import User
from kanban.services import activity_feed as service
from tests.conftest import CSRF_HEADERS
from tests.test_cards import create_card, list_ids, register
from tests.test_comments import add_member

BoardFactory = Callable[..., dict[str, Any]]
LoggedIn = tuple[TestClient, User]

# --------------------------------------------------------------------------- helpers


def feed(api: TestClient, board_id: int, **query: Any) -> dict[str, Any]:
    """`GET /api/boards/{board_id}/activity`, asserting the documented 200."""
    response = api.get(f"/api/boards/{board_id}/activity", params=query)
    assert response.status_code == 200, response.text
    return response.json()


def types_of(page: dict[str, Any]) -> list[str]:
    """The `type` of every row of a page, in the order the feed returned them."""
    return [row["type"] for row in page["items"]]


def data_by_type(page: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Each row's `data` object keyed by its type; the newest row of a type wins."""
    return {row["type"]: row["data"] for row in reversed(page["items"])}


@pytest.fixture
def todo(board: dict[str, Any]) -> int:
    """The seeded `To Do` list of the module's board, where the cards below are created."""
    return list_ids(board["id"])[0]


# --------------------------------------------------------------------------- shape and order


def test_a_new_board_has_exactly_its_board_created_row(
    logged_in: LoggedIn, board: dict[str, Any]
) -> None:
    """Creating a board writes one row, at `board_version = 1` (Sections 4.3 and 3.8)."""
    api, user = logged_in
    page = feed(api, board["id"])

    assert types_of(page) == ["board.created"]
    row = page["items"][0]
    assert row["board_id"] == board["id"]
    assert row["card_id"] is None
    assert row["board_version"] == 1
    assert row["data"] == {"board_name": board["name"]}
    assert row["user"]["id"] == user.id
    assert row["user"]["username"] == user.username
    assert "email" not in row["user"]  # PublicUserOut never carries one (Section 4.2)
    assert page["next_before"] is None


def test_the_feed_is_newest_first(logged_in: LoggedIn, board: dict[str, Any], todo: int) -> None:
    """`ORDER BY id DESC`: the most recent write is the first item (Section 4.3)."""
    api, _user = logged_in
    for title in ("Design home page", "Pick colours", "Write docs"):
        create_card(api, todo, title)

    page = feed(api, board["id"])

    assert types_of(page) == ["card.created"] * 3 + ["board.created"]
    ids = [row["id"] for row in page["items"]]
    assert ids == sorted(ids, reverse=True)
    assert [row["data"]["card_title"] for row in page["items"][:3]] == [
        "Write docs",
        "Pick colours",
        "Design home page",
    ]


def test_every_row_carries_the_names_it_stored(
    logged_in: LoggedIn, board: dict[str, Any], todo: int
) -> None:
    """One write per aggregate: each row renders from `type` + `data` alone (Section 3.8)."""
    api, _user = logged_in
    other, account = register(api, "kay_activity")
    add_member(api, board["id"], account["id"])
    card = create_card(api, todo, "Ship v1")["item"]
    api.patch(f"/api/boards/{board['id']}", json={"name": "Roadmap"}, headers=CSRF_HEADERS)
    api.post(f"/api/boards/{board['id']}/lists", json={"name": "Blocked"}, headers=CSRF_HEADERS)
    api.post(
        f"/api/boards/{board['id']}/labels",
        json={"name": "Urgent", "color": "red"},
        headers=CSRF_HEADERS,
    )
    api.post(f"/api/cards/{card['id']}/comments", json={"body": "Looks good"}, headers=CSRF_HEADERS)
    other.close()

    data = data_by_type(feed(api, board["id"], limit=service.MAX_ACTIVITY_LIMIT))

    assert data["board.created"]["board_name"] == "Sprint 42"
    assert data["member.added"] == {
        "member_id": account["id"],
        "member_name": account["full_name"],
        "role": "member",
    }
    assert data["card.created"] == {"card_title": "Ship v1", "list_name": "To Do"}
    assert data["board.renamed"] == {"from": "Sprint 42", "to": "Roadmap"}
    assert data["list.created"] == {"list_name": "Blocked"}
    assert data["label.created"]["label_name"] == "Urgent"
    assert data["label.created"]["label_color"] == "red"
    assert data["comment.added"]["card_title"] == "Ship v1"
    assert data["comment.added"]["body_preview"] == "Looks good"


def test_a_deleted_card_still_shows_its_title(
    logged_in: LoggedIn, board: dict[str, Any], todo: int
) -> None:
    """`card.deleted` keeps the title and list name, with `card_id` NULL (Section 3.8).

    The card's own rows cascade away with it (`activities.card_id` is `ON DELETE CASCADE`), so this
    denormalised copy is the only thing left to render the sentence from.
    """
    api, _user = logged_in
    card = create_card(api, todo, "Ephemeral plan")["item"]
    assert api.post(f"/api/cards/{card['id']}/archive", headers=CSRF_HEADERS).status_code == 200
    assert api.delete(f"/api/cards/{card['id']}", headers=CSRF_HEADERS).status_code == 204

    page = feed(api, board["id"])

    assert types_of(page) == ["card.deleted", "board.created"]
    deleted = page["items"][0]
    assert deleted["card_id"] is None
    assert deleted["data"] == {"card_title": "Ephemeral plan", "list_name": "To Do"}


def test_card_id_narrows_the_feed_to_one_card(
    logged_in: LoggedIn, board: dict[str, Any], todo: int
) -> None:
    """`card_id` is the Section 4.3 filter; the board's other rows are left out."""
    api, _user = logged_in
    card = create_card(api, todo, "Fix login")["item"]
    create_card(api, todo, "Write docs")
    api.patch(f"/api/cards/{card['id']}", json={"title": "Fix login v2"}, headers=CSRF_HEADERS)

    page = feed(api, board["id"], card_id=card["id"])

    assert types_of(page) == ["card.renamed", "card.created"]
    assert {row["card_id"] for row in page["items"]} == {card["id"]}


# --------------------------------------------------------------------------- paging


def test_paging_by_cursor_never_repeats_or_skips_a_row(
    logged_in: LoggedIn, board: dict[str, Any], todo: int
) -> None:
    """Walking the feed two rows at a time visits exactly the rows one big page returns."""
    api, _user = logged_in
    for index in range(5):
        create_card(api, todo, f"Card {index}")
    expected = [row["id"] for row in feed(api, board["id"])["items"]]
    assert len(expected) == 6  # five cards plus `board.created`

    seen: list[int] = []
    before: int | None = None
    for _page in range(len(expected) + 1):
        page = feed(api, board["id"], limit=2, **({"before": before} if before else {}))
        seen.extend(row["id"] for row in page["items"])
        before = page["next_before"]
        if before is None:
            break

    assert before is None
    assert seen == expected
    assert len(set(seen)) == len(seen)


def test_next_before_is_null_on_a_short_page(
    logged_in: LoggedIn, board: dict[str, Any], todo: int
) -> None:
    """A page that came back under its limit is the last one, so the cursor stops (Section 4.1)."""
    api, _user = logged_in
    create_card(api, todo, "Only card")

    page = feed(api, board["id"], limit=5)  # two rows: `board.created` and `card.created`
    assert len(page["items"]) == 2
    assert page["next_before"] is None

    full = feed(api, board["id"], limit=1)
    assert full["next_before"] == full["items"][0]["id"]


def test_before_returns_the_rows_older_than_the_cursor(
    logged_in: LoggedIn, board: dict[str, Any], todo: int
) -> None:
    """`before` is strict: the row the cursor names is never served twice."""
    api, _user = logged_in
    create_card(api, todo, "Design home page")
    page = feed(api, board["id"])

    older = feed(api, board["id"], before=page["items"][0]["id"])

    assert older["items"] == page["items"][1:]


def test_a_limit_above_the_cap_is_rejected(logged_in: LoggedIn, board: dict[str, Any]) -> None:
    """The Section 4.1 cursor cap is enforced by the route, not clamped silently."""
    api, _user = logged_in

    response = api.get(
        f"/api/boards/{board['id']}/activity",
        params={"limit": service.MAX_ACTIVITY_LIMIT + 1},
    )

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"


# --------------------------------------------------------------------------- access


def test_a_non_member_gets_404(logged_in: LoggedIn, board: dict[str, Any]) -> None:
    """Board ids are not enumerable, so a stranger's read is 404, never 403 (Section 6.6)."""
    api, _user = logged_in
    other, _account = register(api, "mallory_activity")

    response = other.get(f"/api/boards/{board['id']}/activity")
    other.close()

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_an_observer_may_read_the_feed(logged_in: LoggedIn, board: dict[str, Any]) -> None:
    """A feed is a read, and `observer` is the whole requirement (Sections 4.3 and 6.6)."""
    api, _user = logged_in
    other, account = register(api, "olive_activity")
    add_member(api, board["id"], account["id"], role="observer")

    page = feed(other, board["id"])
    other.close()

    assert types_of(page) == ["member.added", "board.created"]


def test_a_closed_board_still_reads(logged_in: LoggedIn, board: dict[str, Any]) -> None:
    """`ClosedBoardPage`'s drawer still shows the history (Sections 4.1 and 2.3.5)."""
    api, _user = logged_in
    assert api.post(f"/api/boards/{board['id']}/close", headers=CSRF_HEADERS).status_code == 200

    page = feed(api, board["id"])

    assert types_of(page) == ["board.closed", "board.created"]
