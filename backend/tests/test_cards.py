"""`/api/lists/{list_id}/cards` and `/api/cards/...` - the composer, patch and archive machine.

Everything is driven through the public API (CLAUDE.md section 6) with two exceptions, both
documented by `conftest`: the seeded lists of a new board and the stored `cards` rows are read
with SQL, because the two endpoints that expose them - the board payload of Section 4.10.1 and
`GET /api/boards/{board_id}/lists` - belong to the sibling M2 slices, and a list is archived the
same way, because `POST /api/lists/{list_id}/archive` belongs to `routers/lists.py`. The helpers
that do it are shared with `test_cards_move.py`, which imports them from here.
"""

from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from kanban import db as db_module
from kanban.models import Card, List
from kanban.ordering import STEP
from tests.conftest import CSRF_HEADERS

BoardFactory = Callable[..., dict[str, Any]]


# --------------------------------------------------------------------------- shared helpers


def session() -> Iterator[Any]:
    """A short-lived Session, closed at once so it never holds a WAL read snapshot open.

    A Session kept open across API calls would hold a WAL read snapshot, so the rows those calls
    write would be invisible to it (Section 6.5.2).
    """
    db = db_module.SessionLocal()
    try:
        yield db
    finally:
        db.rollback()
        db.close()


def list_ids(board_id: int) -> list[int]:
    """The board's lists in `position` order: `To Do`, `Doing`, `Done` for a seeded board."""
    for db in session():
        return list(
            db.execute(
                select(List.id).where(List.board_id == board_id).order_by(List.position, List.id)
            ).scalars()
        )
    raise AssertionError("unreachable")  # pragma: no cover


def archive_list(list_id: int) -> None:
    """Archive one list through the app's own lock discipline (`routers/lists.py` is M2 too)."""
    db = db_module.SessionLocal()
    try:
        with db_module.unversioned_write(db):
            db.execute(update(List).where(List.id == list_id).values(is_archived=1))
    finally:
        db.close()


def set_color_cover(api: TestClient, card_id: int, color: str, size: str = "full") -> None:
    """`PUT /api/cards/{card_id}/cover` with a palette colour (Section 4.5)."""
    response = api.put(
        f"/api/cards/{card_id}/cover",
        json={"kind": "color", "value": color, "size": size},
        headers=CSRF_HEADERS,
    )
    assert response.status_code == 200, response.text


def active_cards(list_id: int) -> list[tuple[int, float]]:
    """`(id, position)` of the list's active cards in the order the client sorts them.

    Archived rows are excluded because `index` is a slot over active siblings only (Section 3.6),
    which is also why an archived row's position may equal an active one's.
    """
    for db in session():
        return [
            (row.id, row.position)
            for row in db.execute(
                select(Card.id, Card.position)
                .where(Card.list_id == list_id, Card.is_archived == 0)
                .order_by(Card.position, Card.id)
            ).all()
        ]
    raise AssertionError("unreachable")  # pragma: no cover


def card_row(card_id: int) -> Any | None:
    """The stored `(id, list_id, position, is_archived)` of a card, or `None` once it is deleted.

    Plain column values, not an ORM instance: the Session is closed before the caller reads them.
    """
    for db in session():
        return db.execute(
            select(Card.id, Card.list_id, Card.position, Card.is_archived).where(Card.id == card_id)
        ).first()
    raise AssertionError("unreachable")  # pragma: no cover


def create_card(api: TestClient, list_id: int, title: str, **body: Any) -> dict[str, Any]:
    """`POST /api/lists/{list_id}/cards`, asserting the documented 201."""
    response = api.post(
        f"/api/lists/{list_id}/cards", json={"title": title, **body}, headers=CSRF_HEADERS
    )
    assert response.status_code == 201, response.text
    return response.json()


def board_version(api: TestClient, board_id: int) -> int:
    return int(api.get(f"/api/boards/{board_id}").json()["board"]["version"])


@pytest.fixture
def todo(board: dict[str, Any]) -> int:
    """The id of the seeded `To Do` list of the module's board."""
    return list_ids(board["id"])[0]


# --------------------------------------------------------------------------- create


def test_create_appends_at_the_bottom_and_numbers_short_ids(
    api: TestClient, board: dict[str, Any], todo: int
) -> None:
    first = create_card(api, todo, "First")
    second = create_card(api, todo, "Second")

    assert first["item"]["position"] == STEP
    assert second["item"]["position"] == 2 * STEP
    assert [first["item"]["short_id"], second["item"]["short_id"]] == [1, 2]
    assert second["board_version"] == first["board_version"] + 1
    assert second["board_version"] == board_version(api, board["id"])


def test_create_at_the_top_halves_the_first_position(api: TestClient, todo: int) -> None:
    create_card(api, todo, "Bottom")

    top = create_card(api, todo, "Top", index="top")["item"]

    assert top["position"] == STEP / 2
    assert [card_id for card_id, _ in active_cards(todo)][0] == top["id"]


def test_create_at_an_index_lands_between_its_neighbours(api: TestClient, todo: int) -> None:
    create_card(api, todo, "A")
    create_card(api, todo, "B")

    middle = create_card(api, todo, "AB", index=1)["item"]

    assert middle["position"] == 1.5 * STEP
    assert [card_id for card_id, _ in active_cards(todo)][1] == middle["id"]


def test_create_with_bottom_appends_like_an_absent_index(api: TestClient, todo: int) -> None:
    create_card(api, todo, "A")

    last = create_card(api, todo, "B", index="bottom")["item"]

    assert last["position"] == 2 * STEP


def test_split_lines_creates_one_card_per_non_empty_line(api: TestClient, todo: int) -> None:
    created = create_card(api, todo, "One\n  Two  \n\nThree", split_lines=True)

    assert [item["title"] for item in created["items"]] == ["One", "Two", "Three"]
    assert [item["position"] for item in created["items"]] == [STEP, 2 * STEP, 3 * STEP]
    assert [item["short_id"] for item in created["items"]] == [1, 2, 3]
    # One transaction, so one version bump for the whole paste (Section 4.1).
    assert created["board_version"] == 2


def test_split_lines_at_the_top_keeps_the_pasted_order(api: TestClient, todo: int) -> None:
    anchor = create_card(api, todo, "Anchor")["item"]

    created = create_card(api, todo, "One\nTwo", split_lines=True, index="top")

    assert [card_id for card_id, _ in active_cards(todo)] == [
        created["items"][0]["id"],
        created["items"][1]["id"],
        anchor["id"],
    ]


def test_client_id_is_echoed_for_the_rows_lifetime(api: TestClient, todo: int) -> None:
    item = create_card(api, todo, "Optimistic", client_id="tmp_deadbeef01")["item"]

    assert item["client_id"] == "tmp_deadbeef01"
    read = api.get(f"/api/cards/{item['id']}")
    assert read.json()["client_id"] == "tmp_deadbeef01"
    moved = api.post(
        f"/api/cards/{item['id']}/move",
        json={"to_list_id": todo, "index": 0},
        headers=CSRF_HEADERS,
    )
    assert moved.json()["item"]["client_id"] == "tmp_deadbeef01"


def test_a_card_without_a_client_id_omits_the_field(api: TestClient, todo: int) -> None:
    item = create_card(api, todo, "Plain")["item"]

    assert "client_id" not in item


def test_split_lines_stores_the_client_id_on_the_first_card_only(
    api: TestClient, todo: int
) -> None:
    created = create_card(api, todo, "One\nTwo", split_lines=True, client_id="tmp_paste1")

    assert created["items"][0]["client_id"] == "tmp_paste1"
    assert "client_id" not in created["items"][1]


@pytest.mark.parametrize("client_id", ["nope", "tmp_", "tmp_not-hex!"])
def test_create_rejects_a_client_id_outside_the_documented_pattern(
    api: TestClient, todo: int, client_id: str
) -> None:
    response = api.post(
        f"/api/lists/{todo}/cards",
        json={"title": "Bad id", "client_id": client_id},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_create_requires_a_title(api: TestClient, todo: int) -> None:
    response = api.post(f"/api/lists/{todo}/cards", json={"title": "   "}, headers=CSRF_HEADERS)

    assert response.status_code == 422


def test_create_attaches_the_composer_labels(
    api: TestClient, board: dict[str, Any], todo: int
) -> None:
    labels = api.get(f"/api/boards/{board['id']}").json()["labels"]

    item = create_card(
        api,
        todo,
        "#green Tagged",
        label_ids=[labels[1]["id"], labels[0]["id"], labels[0]["id"]],
    )["item"]

    # `label_ids` come back in label `position` order, not request order, and a repeat is one row.
    assert item["label_ids"] == [labels[0]["id"], labels[1]["id"]]


def test_create_rejects_a_label_of_another_board(
    api: TestClient, board_factory: BoardFactory, todo: int
) -> None:
    other_board = board_factory("Other board")
    foreign = api.get(f"/api/boards/{other_board['id']}").json()["labels"][0]["id"]

    response = api.post(
        f"/api/lists/{todo}/cards",
        json={"title": "Foreign label", "label_ids": [foreign]},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 400
    assert response.json()["error"]["details"] == {"label_ids": [foreign]}


def test_create_in_an_archived_list_is_400(api: TestClient, todo: int) -> None:
    archive_list(todo)

    response = api.post(f"/api/lists/{todo}/cards", json={"title": "Hidden"}, headers=CSRF_HEADERS)

    assert response.status_code == 400
    assert response.json()["error"]["details"] == {"list_id": todo}


def test_a_pasted_url_becomes_a_link_attachment_named_after_its_host(
    api: TestClient, todo: int
) -> None:
    """Section 4.4: a bare `http(s)` title is a pasted link, so the host becomes the title."""

    item = create_card(api, todo, "https://example.com/launch")["item"]

    assert item["title"] == "example.com"
    assert item["badges"]["attachments"] == 1

    detail = api.get(f"/api/cards/{item['id']}").json()
    assert [(row["kind"], row["url"], row["name"]) for row in detail["attachments"]] == [
        ("link", "https://example.com/launch", "example.com")
    ]


def test_the_pasted_url_records_its_attachment_after_the_card(
    api: TestClient, board: dict[str, Any], todo: int
) -> None:
    """Section 4.4 orders the two rows: `card.created` first, then `attachment.added`."""

    card_id = create_card(api, todo, "https://example.com/launch")["item"]["id"]

    page = api.get(f"/api/boards/{board['id']}/activity", params={"card_id": card_id}).json()
    assert [row["type"] for row in page["items"]] == ["attachment.added", "card.created"]
    assert page["items"][0]["data"]["attachment_name"] == "example.com"


def test_a_title_that_only_looks_like_a_link_is_kept(api: TestClient, todo: int) -> None:
    """A scheme-less host, a spaced sentence and a non-http scheme are all ordinary titles."""

    for title in ("example.com/launch", "Read https://example.com now", "ftp://example.com"):
        item = create_card(api, todo, title)["item"]
        assert item["title"] == title
        assert item["badges"]["attachments"] == 0


def test_a_url_with_no_host_stays_the_title(api: TestClient, todo: int) -> None:
    """There is no host to name the card after, so nothing the person pasted is lost."""

    item = create_card(api, todo, "https:///launch")["item"]

    assert item["title"] == "https:///launch"
    assert item["badges"]["attachments"] == 0


def test_every_pasted_line_that_is_a_url_gets_its_own_link(api: TestClient, todo: int) -> None:
    """`split_lines` creates one card per line, so the rule applies per card (Section 4.4)."""

    response = api.post(
        f"/api/lists/{todo}/cards",
        json={
            "title": "https://one.example/a\nPlain title\nhttps://two.example/b",
            "split_lines": True,
        },
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 201
    items = response.json()["items"]
    assert [row["title"] for row in items] == ["one.example", "Plain title", "two.example"]
    assert [row["badges"]["attachments"] for row in items] == [1, 0, 1]


def test_create_needs_a_list_that_exists(api: TestClient) -> None:
    response = api.post("/api/lists/999999/cards", json={"title": "Nowhere"}, headers=CSRF_HEADERS)

    assert response.status_code == 404


# --------------------------------------------------------------------------- read and patch


def test_the_summary_carries_every_documented_field(api: TestClient, todo: int) -> None:
    item = create_card(api, todo, "Shape")["item"]

    assert set(item) == {
        "id",
        "board_id",
        "list_id",
        "short_id",
        "title",
        "position",
        "is_archived",
        "is_template",
        "start_at",
        "due_at",
        "due_complete",
        "cover",
        "label_ids",
        "badges",
        "created_at",
        "updated_at",
    }
    assert item["cover"] is None
    assert item["badges"] == {
        "description": False,
        "attachments": 0,
        "checklist_done": 0,
        "checklist_total": 0,
    }


def test_a_stored_cover_is_rendered_as_the_documented_object(api: TestClient, todo: int) -> None:
    item = create_card(api, todo, "With a cover")["item"]
    set_color_cover(api, item["id"], "green")

    # Section 4.5 types `image_url` / `dominant_color` as optional and the Section 4.10.1 example
    # of a colour cover carries neither key, so they are absent rather than null.
    assert api.get(f"/api/cards/{item['id']}").json()["cover"] == {
        "kind": "color",
        "value": "green",
        "size": "full",
    }


def test_rename_records_the_new_title(api: TestClient, board: dict[str, Any], todo: int) -> None:
    item = create_card(api, todo, "Draft")["item"]

    response = api.patch(f"/api/cards/{item['id']}", json={"title": "Final"}, headers=CSRF_HEADERS)

    assert response.status_code == 200
    assert response.json()["item"]["title"] == "Final"
    assert response.json()["board_version"] == board_version(api, board["id"])
    assert api.get(f"/api/cards/{item['id']}").json()["title"] == "Final"


# `description` joined this body in M3 (Section 4.5); the fields `PATCH` never accepts and the
# non-nullable ones are pinned here, and the M3 body itself in `test_cards_patch.py`.
@pytest.mark.parametrize("body", [{"title": None}, {"is_archived": True}, {"list_id": 1}])
def test_patch_refuses_null_and_fields_that_are_not_scalars_of_a_card(
    api: TestClient, todo: int, body: dict[str, Any]
) -> None:
    item = create_card(api, todo, "Locked")["item"]

    response = api.patch(f"/api/cards/{item['id']}", json=body, headers=CSRF_HEADERS)

    assert response.status_code == 422


def test_reading_a_card_that_does_not_exist_is_404(api: TestClient) -> None:
    assert api.get("/api/cards/999999").status_code == 404


# --------------------------------------------------------------------------- archive / delete


def test_archive_flags_the_card_and_keeps_its_position(api: TestClient, todo: int) -> None:
    item = create_card(api, todo, "Done with this")["item"]

    response = api.post(f"/api/cards/{item['id']}/archive", headers=CSRF_HEADERS)

    assert response.status_code == 200
    archived = response.json()["item"]
    assert archived["is_archived"] is True
    assert archived["position"] == item["position"]
    # Hidden from the board, but still readable so the modal can show the archived banner.
    assert active_cards(todo) == []
    assert api.get(f"/api/cards/{item['id']}").json()["is_archived"] is True


def test_an_archived_card_is_not_an_active_sibling(api: TestClient, todo: int) -> None:
    first = create_card(api, todo, "A")["item"]
    second = create_card(api, todo, "B")["item"]
    api.post(f"/api/cards/{first['id']}/archive", headers=CSRF_HEADERS)

    inserted = create_card(api, todo, "New A", index=0)["item"]

    assert [card_id for card_id, _ in active_cards(todo)] == [inserted["id"], second["id"]]
    assert card_row(first["id"]).position == first["position"]  # type: ignore[union-attr]


def test_archive_is_idempotent(api: TestClient, todo: int) -> None:
    item = create_card(api, todo, "Twice")["item"]

    api.post(f"/api/cards/{item['id']}/archive", headers=CSRF_HEADERS)
    again = api.post(f"/api/cards/{item['id']}/archive", headers=CSRF_HEADERS)

    assert again.status_code == 200
    assert again.json()["item"]["is_archived"] is True


def test_delete_before_archive_is_409(api: TestClient, todo: int) -> None:
    item = create_card(api, todo, "Still active")["item"]

    response = api.delete(f"/api/cards/{item['id']}", headers=CSRF_HEADERS)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"
    assert card_row(item["id"]) is not None


def test_delete_after_archive_removes_the_row(api: TestClient, todo: int) -> None:
    item = create_card(api, todo, "Goodbye")["item"]
    api.post(f"/api/cards/{item['id']}/archive", headers=CSRF_HEADERS)

    response = api.delete(f"/api/cards/{item['id']}", headers=CSRF_HEADERS)

    assert response.status_code == 204
    assert card_row(item["id"]) is None
    assert api.get(f"/api/cards/{item['id']}").status_code == 404


def test_unarchive_restores_the_original_slot(api: TestClient, todo: int) -> None:
    first = create_card(api, todo, "A")["item"]
    middle = create_card(api, todo, "B")["item"]
    last = create_card(api, todo, "C")["item"]
    api.post(f"/api/cards/{middle['id']}/archive", headers=CSRF_HEADERS)

    response = api.post(f"/api/cards/{middle['id']}/unarchive", headers=CSRF_HEADERS)

    assert response.status_code == 200
    restored = response.json()["item"]
    assert restored["is_archived"] is False
    assert restored["position"] == middle["position"]
    assert [card_id for card_id, _ in active_cards(todo)] == [
        first["id"],
        middle["id"],
        last["id"],
    ]


def test_unarchive_from_an_archived_list_appends_to_the_first_active_list(
    api: TestClient, board: dict[str, Any], todo: int
) -> None:
    doing = list_ids(board["id"])[1]
    parked = create_card(api, todo, "Parked")["item"]
    create_card(api, doing, "Already here")
    api.post(f"/api/cards/{parked['id']}/archive", headers=CSRF_HEADERS)
    archive_list(todo)

    restored = api.post(f"/api/cards/{parked['id']}/unarchive", headers=CSRF_HEADERS).json()["item"]

    assert restored["list_id"] == doing
    assert restored["position"] == 2 * STEP
    assert [card_id for card_id, _ in active_cards(doing)][-1] == parked["id"]


def test_unarchive_into_a_board_with_no_active_list_is_409_and_changes_nothing(
    api: TestClient, board: dict[str, Any], todo: int
) -> None:
    item = create_card(api, todo, "Nowhere to go")["item"]
    api.post(f"/api/cards/{item['id']}/archive", headers=CSRF_HEADERS)
    for list_id in list_ids(board["id"]):
        archive_list(list_id)

    response = api.post(f"/api/cards/{item['id']}/unarchive", headers=CSRF_HEADERS)

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "conflict"
    assert error["message"] == "Send a list to the board first"
    assert error["details"] == {"list_id": todo}
    stored = card_row(item["id"])
    assert stored is not None
    assert stored.is_archived == 1
    assert stored.list_id == todo


def test_unarchive_is_idempotent_for_an_active_card(api: TestClient, todo: int) -> None:
    item = create_card(api, todo, "Already here")["item"]

    response = api.post(f"/api/cards/{item['id']}/unarchive", headers=CSRF_HEADERS)

    assert response.status_code == 200
    assert response.json()["item"]["position"] == item["position"]


# --------------------------------------------------------------------------- access


def test_a_card_id_that_does_not_exist_is_404_for_every_verb(api: TestClient) -> None:
    """`card_access` resolves the card's board first, so a missing card never reaches a service."""
    assert api.get("/api/cards/999999").status_code == 404
    assert (
        api.patch("/api/cards/999999", json={"title": "Ghost"}, headers=CSRF_HEADERS).status_code
        == 404
    )
    assert api.post("/api/cards/999999/archive", headers=CSRF_HEADERS).status_code == 404
    assert api.delete("/api/cards/999999", headers=CSRF_HEADERS).status_code == 404


def test_a_closed_board_freezes_its_cards(
    api: TestClient, board: dict[str, Any], todo: int
) -> None:
    item = create_card(api, todo, "Frozen")["item"]
    assert api.post(f"/api/boards/{board['id']}/close", headers=CSRF_HEADERS).status_code == 200

    response = api.patch(
        f"/api/cards/{item['id']}", json={"title": "Still editing"}, headers=CSRF_HEADERS
    )

    assert response.status_code == 409
    assert response.json()["error"]["message"] == "Board is closed"
    # Reads are never refused (Section 4.1).
    assert api.get(f"/api/cards/{item['id']}").status_code == 200


def test_a_mutation_without_the_csrf_header_is_refused(api: TestClient, todo: int) -> None:
    response = api.post(f"/api/lists/{todo}/cards", json={"title": "No header"})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_header_missing"
