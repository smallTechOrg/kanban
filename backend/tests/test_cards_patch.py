"""`PATCH /api/cards/{card_id}` and `GET /api/cards/{card_id}` as the card modal drives them.

Section 4.5 widens the patch body from M2's rename to every scalar field of a card and names the
activity type each one writes (Section 3.8); this module pins one test per field, reading the rows
back through `GET /api/boards/{board_id}/activity?card_id=...`, which is the public interface for
them (CLAUDE.md section 6). The tile badges are read back through the board payload as well as the
card detail, because the tile is what the counts are for. Helpers come from `test_cards.py`, which
documents the two places a test may read SQL directly.
"""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import CSRF_HEADERS
from tests.test_cards import create_card, list_ids

BoardFactory = Callable[..., dict[str, Any]]

#: A due date in the one format Section 4.1 accepts: ISO-8601 UTC with a `Z` suffix.
DUE = "2026-09-30T15:00:00.000Z"
START = "2026-09-20T09:00:00.000Z"

#: Every construct `MarkdownView` renders (Section 5.7), in one body, to prove the round trip.
MARKDOWN = (
    "# Heading\n\n"
    "A paragraph with **bold**, _italic_, `code` and a https://example.com autolink.\n\n"
    "- [ ] unchecked task\n"
    "- [x] checked task\n\n"
    "| Column | Value |\n"
    "| --- | --- |\n"
    "| one | 1 |\n\n"
    "```python\n"
    'print("hello")\n'
    "```\n\n"
    "> A quote with a <script>alert(1)</script> that is never rendered as HTML."
)


# --------------------------------------------------------------------------- helpers


@pytest.fixture
def card(api: TestClient, board: dict[str, Any]) -> dict[str, Any]:
    """One card in the seeded `To Do` list, which every patch in this module addresses."""
    return create_card(api, list_ids(board["id"])[0], "Design home page")["item"]


def patch(api: TestClient, card_id: int, **body: Any) -> dict[str, Any]:
    """`PATCH /api/cards/{card_id}`, asserting the documented 200."""
    response = api.patch(f"/api/cards/{card_id}", json=body, headers=CSRF_HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


def detail(api: TestClient, card_id: int) -> dict[str, Any]:
    """`GET /api/cards/{card_id}`: the `CardDetail` of Section 4.5."""
    response = api.get(f"/api/cards/{card_id}")
    assert response.status_code == 200, response.text
    return response.json()


def card_activity(api: TestClient, card: dict[str, Any]) -> list[dict[str, Any]]:
    """The card's own activity rows, newest first (Sections 4.3 and 4.5)."""
    response = api.get(
        f"/api/boards/{card['board_id']}/activity",
        params={"card_id": card["id"], "limit": 200},
    )
    assert response.status_code == 200, response.text
    return list(response.json()["items"])


def activity_types(api: TestClient, card: dict[str, Any]) -> list[str]:
    """Every activity type on the card, newest first."""
    return [row["type"] for row in card_activity(api, card)]


def newest_activity(api: TestClient, card: dict[str, Any]) -> dict[str, Any]:
    """The newest activity row on the card, as `ActivityOut`."""
    return card_activity(api, card)[0]


def tile(api: TestClient, board_id: int, card_id: int) -> dict[str, Any]:
    """One card as the board payload hands it to `CardTile` (Section 4.10.1)."""
    payload = api.get(f"/api/boards/{board_id}").json()
    return next(item for item in payload["cards"] if item["id"] == card_id)


# --------------------------------------------------------------------------- the detail document


def test_the_detail_carries_every_documented_field(
    api: TestClient, board: dict[str, Any], card: dict[str, Any]
) -> None:
    item = detail(api, card["id"])

    # `CardSummary` plus the four fields and the one child array only the modal needs (4.5).
    assert set(item) == {
        "id",
        "board_id",
        "list_id",
        "short_id",
        "title",
        "position",
        "is_archived",
        "start_at",
        "due_at",
        "due_complete",
        "due_reminder_minutes",
        "description",
        "board_name",
        "list_name",
        "items",
        "label_ids",
        "badges",
        "created_at",
        "updated_at",
    }
    assert item["description"] == ""
    assert item["due_reminder_minutes"] is None
    assert item["board_name"] == board["name"]
    assert item["list_name"] == "To Do"
    assert item["items"] == []


def test_the_detail_follows_the_card_to_another_list(
    api: TestClient, board: dict[str, Any], card: dict[str, Any]
) -> None:
    doing = list_ids(board["id"])[1]

    moved = api.post(
        f"/api/cards/{card['id']}/move",
        json={"to_list_id": doing, "index": 0},
        headers=CSRF_HEADERS,
    )
    assert moved.status_code == 200, moved.text

    assert detail(api, card["id"])["list_name"] == "Doing"


# --------------------------------------------------------------------------- one row per field


def test_renaming_records_card_renamed(api: TestClient, card: dict[str, Any]) -> None:
    assert patch(api, card["id"], title="Design the home page")["item"]["title"] == (
        "Design the home page"
    )

    row = newest_activity(api, card)
    assert row["type"] == "card.renamed"
    assert row["data"] == {"from": "Design home page", "to": "Design the home page"}


def test_a_description_records_card_description_changed_and_round_trips_markdown(
    api: TestClient, card: dict[str, Any]
) -> None:
    patch(api, card["id"], description=MARKDOWN)

    # Byte for byte: the server stores Markdown, never renders or rewrites it (Section 5.7).
    assert detail(api, card["id"])["description"] == MARKDOWN
    row = newest_activity(api, card)
    assert row["type"] == "card.description_changed"
    # The body never travels in `data`; only the fact that it changed (Section 3.8).
    assert row["data"] == {"card_title": "Design home page"}


def test_clearing_a_description_records_the_same_type(
    api: TestClient, card: dict[str, Any]
) -> None:
    patch(api, card["id"], description="Something")

    patch(api, card["id"], description="")

    assert detail(api, card["id"])["description"] == ""
    assert activity_types(api, card) == [
        "card.description_changed",
        "card.description_changed",
        "card.created",
    ]


def test_setting_the_dates_records_one_card_due_set(api: TestClient, card: dict[str, Any]) -> None:
    item = patch(api, card["id"], start_at=START, due_at=DUE, due_reminder_minutes=60)["item"]

    assert (item["start_at"], item["due_at"]) == (START, DUE)
    assert detail(api, card["id"])["due_reminder_minutes"] == 60
    row = newest_activity(api, card)
    # `start_at` and `due_at` are one user-visible concern - one popover, one Save - so they write
    # one row carrying both, which is the shape of the Section 3.8 table.
    assert row["type"] == "card.due_set"
    assert row["data"] == {"card_title": "Design home page", "start_at": START, "due_at": DUE}
    assert activity_types(api, card) == ["card.due_set", "card.created"]


def test_the_reminder_alone_records_nothing(api: TestClient, card: dict[str, Any]) -> None:
    patch(api, card["id"], due_at=DUE)

    patch(api, card["id"], due_reminder_minutes=1440)

    # Section 3.8 has no activity type for a reminder; it is a notification setting, not history.
    assert detail(api, card["id"])["due_reminder_minutes"] == 1440
    assert activity_types(api, card) == ["card.due_set", "card.created"]


def test_clearing_the_due_date_records_card_due_removed(
    api: TestClient, card: dict[str, Any]
) -> None:
    patch(api, card["id"], start_at=START, due_at=DUE, due_reminder_minutes=15)

    item = patch(api, card["id"], start_at=None, due_at=None, due_reminder_minutes=None)["item"]

    assert (item["start_at"], item["due_at"]) == (None, None)
    assert detail(api, card["id"])["due_reminder_minutes"] is None
    assert activity_types(api, card) == ["card.due_removed", "card.due_set", "card.created"]
    assert newest_activity(api, card)["data"] == {"card_title": "Design home page"}


def test_re_sending_the_same_dates_records_nothing(api: TestClient, card: dict[str, Any]) -> None:
    patch(api, card["id"], due_at=DUE)

    patch(api, card["id"], due_at=DUE)

    assert activity_types(api, card) == ["card.due_set", "card.created"]


def test_due_complete_toggles_between_its_two_types(api: TestClient, card: dict[str, Any]) -> None:
    patch(api, card["id"], due_at=DUE)

    assert patch(api, card["id"], due_complete=True)["item"]["due_complete"] is True
    assert activity_types(api, card)[0] == "card.due_completed"

    assert patch(api, card["id"], due_complete=False)["item"]["due_complete"] is False
    assert activity_types(api, card)[0] == "card.due_incompleted"

    # Idempotent: ticking an already-ticked checkbox records nothing.
    patch(api, card["id"], due_complete=False)
    assert activity_types(api, card) == [
        "card.due_incompleted",
        "card.due_completed",
        "card.due_set",
        "card.created",
    ]


def test_two_fields_in_one_body_record_two_rows_in_one_transaction(
    api: TestClient, board: dict[str, Any], card: dict[str, Any]
) -> None:
    before = api.get(f"/api/boards/{board['id']}").json()["board"]["version"]

    result = patch(api, card["id"], title="Renamed", description="Described")

    assert activity_types(api, card) == [
        "card.description_changed",
        "card.renamed",
        "card.created",
    ]
    # One `write_tx` per request, so one version bump however many fields changed (Section 4.1).
    assert result["board_version"] == before + 1


# --------------------------------------------------------------------------- body validation


@pytest.mark.parametrize(
    "body",
    [
        {"title": None},
        {"description": None},
        {"due_complete": None},
        {"is_archived": True},
        {"position": 1.5},
        {"due_at": "2026-09-30 15:00:00"},
        {"due_at": "2026-09-30T15:00:00+02:00"},
        {"due_reminder_minutes": 7},
        {"due_reminder_minutes": -5},
    ],
)
def test_the_patch_body_refuses_what_section_4_5_does_not_allow(
    api: TestClient, card: dict[str, Any], body: dict[str, Any]
) -> None:
    response = api.patch(f"/api/cards/{card['id']}", json=body, headers=CSRF_HEADERS)

    assert response.status_code == 422


# --------------------------------------------------------------------------- the tile badges


def test_the_description_badge_lights_up_on_the_tile(
    api: TestClient, board: dict[str, Any], card: dict[str, Any]
) -> None:
    assert tile(api, board["id"], card["id"])["badges"]["description"] is False

    patch(api, card["id"], description="Now it has one")

    assert tile(api, board["id"], card["id"])["badges"]["description"] is True
    assert detail(api, card["id"])["badges"]["description"] is True

    patch(api, card["id"], description="")

    assert tile(api, board["id"], card["id"])["badges"]["description"] is False


def test_items_count_towards_the_same_badges_on_both_readers(
    api: TestClient, board: dict[str, Any], card: dict[str, Any]
) -> None:
    """The tile and the modal read the same two numbers, from the same two tables."""
    for name in ("Wireframe", "Palette"):
        added = api.post(
            f"/api/cards/{card['id']}/items", json={"name": name}, headers=CSRF_HEADERS
        )
        assert added.status_code == 201, added.text
    items = detail(api, card["id"])["items"]
    ticked = api.patch(
        f"/api/card-items/{items[0]['id']}", json={"is_checked": True}, headers=CSRF_HEADERS
    )
    assert ticked.status_code == 200, ticked.text

    badges = {
        "board payload": tile(api, board["id"], card["id"])["badges"],
        "card detail": detail(api, card["id"])["badges"],
    }

    for source, counts in badges.items():
        assert counts == {"description": False, "item_done": 1, "item_total": 2}, source


def test_the_detail_embeds_the_cards_items_in_position_order(
    api: TestClient, card: dict[str, Any]
) -> None:
    for name in ("Wireframe", "Palette"):
        added = api.post(
            f"/api/cards/{card['id']}/items", json={"name": name}, headers=CSRF_HEADERS
        )
        assert added.status_code == 201, added.text

    items = detail(api, card["id"])["items"]

    assert [item["name"] for item in items] == ["Wireframe", "Palette"]
    assert [item["card_id"] for item in items] == [card["id"], card["id"]]
    assert [item["position"] for item in items] == sorted(item["position"] for item in items)
    assert set(items[0]) == {
        "id",
        "card_id",
        "name",
        "position",
        "is_checked",
        "checked_at",
        "due_at",
    }
