"""`/api/lists` - the column CRUD, the reorder and the bulk card operations (Section 4.4).

Everything is driven through the public API (CLAUDE.md section 6) with one documented exception:
`_insert_cards` writes `cards` rows through the app's own lock discipline, because the fixtures of
the sort tests need `created_at` and `due_at` values and M2's `PATCH /api/cards/{card_id}` accepts
`title` alone (Section 4.5; the rest of that body arrives with the card modal in M3). Every
assertion about those cards still goes through the list endpoints.
"""

from collections.abc import Callable, Sequence
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text

from kanban import db as db_module
from kanban.models import Card, CardLabel
from kanban.ordering import STEP
from kanban.schemas.lists import UNARCHIVE_CARDS_LIMIT
from tests.conftest import CSRF_HEADERS

BoardFactory = Callable[..., dict[str, Any]]


# --------------------------------------------------------------------------- helpers


def _lists(api: TestClient, board_id: int) -> list[dict[str, Any]]:
    response = api.get(f"/api/boards/{board_id}/lists")
    assert response.status_code == 200, response.text
    return response.json()["items"]


def _names(api: TestClient, board_id: int) -> list[str]:
    return [row["name"] for row in _lists(api, board_id)]


def _create(api: TestClient, board_id: int, name: str, **body: Any) -> dict[str, Any]:
    response = api.post(
        f"/api/boards/{board_id}/lists", json={"name": name, **body}, headers=CSRF_HEADERS
    )
    assert response.status_code == 201, response.text
    return response.json()


def _version(api: TestClient, board_id: int) -> int:
    response = api.get(f"/api/boards/{board_id}")
    assert response.status_code == 200, response.text
    return int(response.json()["board"]["version"])


def _activity_types(board_id: int) -> list[str]:
    """Every `activities.type` of the board, oldest first, read in its own short session."""
    session = db_module.SessionLocal()
    try:
        rows = session.execute(
            text("SELECT type FROM activities WHERE board_id = :id ORDER BY id"), {"id": board_id}
        )
        return [row.type for row in rows]
    finally:
        session.rollback()
        session.close()


def _card_rows(list_id: int) -> list[tuple[int, str, float, int]]:
    """`(id, title, position, is_archived)` of a list's cards, in `position` order."""
    session = db_module.SessionLocal()
    try:
        rows = session.execute(
            select(Card.id, Card.title, Card.position, Card.is_archived)
            .where(Card.list_id == list_id)
            .order_by(Card.position, Card.id)
        ).all()
        return [(row.id, row.title, row.position, row.is_archived) for row in rows]
    finally:
        session.rollback()
        session.close()


def _insert_cards(board_id: int, list_id: int, cards: Sequence[dict[str, Any]]) -> list[int]:
    """Insert `cards` rows with the app's own lock discipline (see the module docstring).

    Each entry is the column overrides of one card (`title` at least); positions are spaced by
    `ordering.STEP` in the order given, exactly as an append through the card router would.
    """
    session = db_module.SessionLocal()
    try:
        with db_module.unversioned_write(session):
            highest = session.execute(
                select(func.max(Card.short_id)).where(Card.board_id == board_id)
            ).scalar()
            short_id = int(highest or 0)
            created: list[int] = []
            for rank, columns in enumerate(cards, start=1):
                short_id += 1
                row = Card(
                    board_id=board_id,
                    list_id=list_id,
                    short_id=short_id,
                    position=STEP * rank,
                    **columns,
                )
                session.add(row)
                session.flush()
                created.append(row.id)
            return created
    finally:
        session.close()


@pytest.fixture
def empty_board(board_factory: BoardFactory) -> dict[str, Any]:
    """A board with no lists at all, so a test owns every position it creates."""
    return board_factory("Lists board", default_lists=False)


# --------------------------------------------------------------------------- create


def test_create_appends_at_the_end(api: TestClient, board: dict[str, Any]) -> None:
    """`index` omitted appends, at `max(position) + STEP` (Section 3.6)."""
    created = _create(api, board["id"], "Shipped")
    assert created["item"]["position"] == STEP * 4  # after the three seeded lists
    assert created["item"]["color"] is None
    assert created["item"]["is_archived"] is False
    assert created["board_version"] == board["version"] + 1
    assert _names(api, board["id"]) == ["To Do", "Doing", "Done", "Shipped"]


def test_create_at_index_zero_goes_to_the_top(api: TestClient, board: dict[str, Any]) -> None:
    created = _create(api, board["id"], "Inbox", index=0)
    assert created["item"]["position"] == STEP / 2
    assert _names(api, board["id"])[0] == "Inbox"


def test_create_clamps_an_index_past_the_end(api: TestClient, board: dict[str, Any]) -> None:
    """The server clamps to append; the client's view may be stale (Section 3.6)."""
    _create(api, board["id"], "Last", index=99)
    assert _names(api, board["id"])[-1] == "Last"


def test_create_rejects_a_blank_name(api: TestClient, board: dict[str, Any]) -> None:
    response = api.post(
        f"/api/boards/{board['id']}/lists", json={"name": " "}, headers=CSRF_HEADERS
    )
    assert response.status_code == 422, response.text


# --------------------------------------------------------------------------- read


def test_read_lists_carries_the_active_card_count(
    api: TestClient, empty_board: dict[str, Any]
) -> None:
    list_id = _create(api, empty_board["id"], "To Do")["item"]["id"]
    _insert_cards(
        empty_board["id"],
        list_id,
        [{"title": "Visible"}, {"title": "Hidden", "is_archived": 1}],
    )
    _create(api, empty_board["id"], "Empty")
    rows = _lists(api, empty_board["id"])
    assert [(row["name"], row["card_count"]) for row in rows] == [("To Do", 1), ("Empty", 0)]


# --------------------------------------------------------------------------- patch


def test_rename_records_list_renamed(api: TestClient, board: dict[str, Any]) -> None:
    list_id = _lists(api, board["id"])[0]["id"]
    response = api.patch(
        f"/api/lists/{list_id}", json={"name": "In progress"}, headers=CSRF_HEADERS
    )
    assert response.status_code == 200, response.text
    assert response.json()["item"]["name"] == "In progress"
    assert _activity_types(board["id"])[-1] == "list.renamed"


def test_color_is_set_and_removed(api: TestClient, board: dict[str, Any]) -> None:
    list_id = _lists(api, board["id"])[0]["id"]
    set_response = api.patch(f"/api/lists/{list_id}", json={"color": "green"}, headers=CSRF_HEADERS)
    assert set_response.status_code == 200, set_response.text
    assert set_response.json()["item"]["color"] == "green"
    removed = api.patch(f"/api/lists/{list_id}", json={"color": None}, headers=CSRF_HEADERS)
    assert removed.status_code == 200, removed.text
    assert removed.json()["item"]["color"] is None
    assert _activity_types(board["id"])[-2:] == ["list.color_changed", "list.color_changed"]


def test_patch_rejects_an_unknown_colour_a_null_name_and_an_empty_body(
    api: TestClient, board: dict[str, Any]
) -> None:
    list_id = _lists(api, board["id"])[0]["id"]
    for body in ({"color": "turquoise"}, {"name": None}, {}):
        response = api.patch(f"/api/lists/{list_id}", json=body, headers=CSRF_HEADERS)
        assert response.status_code == 422, (body, response.text)


def test_patching_a_name_to_itself_records_nothing(api: TestClient, board: dict[str, Any]) -> None:
    row = _lists(api, board["id"])[0]
    before = _activity_types(board["id"])
    response = api.patch(
        f"/api/lists/{row['id']}", json={"name": row["name"]}, headers=CSRF_HEADERS
    )
    assert response.status_code == 200, response.text
    assert _activity_types(board["id"]) == before


# --------------------------------------------------------------------------- move


def test_move_to_index_zero_and_to_the_end(api: TestClient, board: dict[str, Any]) -> None:
    rows = _lists(api, board["id"])
    done = rows[2]["id"]
    to_top = api.post(f"/api/lists/{done}/move", json={"index": 0}, headers=CSRF_HEADERS)
    assert to_top.status_code == 200, to_top.text
    assert to_top.json()["positions"] == {}
    assert _names(api, board["id"]) == ["Done", "To Do", "Doing"]
    to_end = api.post(f"/api/lists/{done}/move", json={"index": 2}, headers=CSRF_HEADERS)
    assert to_end.status_code == 200, to_end.text
    assert _names(api, board["id"]) == ["To Do", "Doing", "Done"]
    assert to_end.json()["item"]["position"] > _lists(api, board["id"])[1]["position"]


def test_move_with_neighbours_lands_between_them(api: TestClient, board: dict[str, Any]) -> None:
    """`onDragEnd` sends `index` and both neighbours; the neighbours win (Section 4.9)."""
    to_do, doing, done = (row["id"] for row in _lists(api, board["id"]))
    response = api.post(
        f"/api/lists/{done}/move",
        json={"index": 0, "prev_id": to_do, "next_id": doing},
        headers=CSRF_HEADERS,
    )
    assert response.status_code == 200, response.text
    assert _names(api, board["id"]) == ["To Do", "Done", "Doing"]


def test_move_rejects_the_list_as_its_own_neighbour(api: TestClient, board: dict[str, Any]) -> None:
    list_id = _lists(api, board["id"])[0]["id"]
    response = api.post(
        f"/api/lists/{list_id}/move",
        json={"index": 1, "prev_id": list_id},
        headers=CSRF_HEADERS,
    )
    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "bad_request"


def test_move_rejects_a_neighbour_from_another_board(
    api: TestClient, board: dict[str, Any], board_factory: BoardFactory
) -> None:
    other = board_factory("Other board")
    foreign = _lists(api, other["id"])[0]["id"]
    list_id = _lists(api, board["id"])[0]["id"]
    response = api.post(
        f"/api/lists/{list_id}/move",
        json={"index": 0, "next_id": foreign},
        headers=CSRF_HEADERS,
    )
    assert response.status_code == 400, response.text


def test_move_rejects_a_negative_index(api: TestClient, board: dict[str, Any]) -> None:
    list_id = _lists(api, board["id"])[0]["id"]
    response = api.post(f"/api/lists/{list_id}/move", json={"index": -1}, headers=CSRF_HEADERS)
    assert response.status_code == 422, response.text


def test_a_move_reports_a_renumbered_board(api: TestClient, empty_board: dict[str, Any]) -> None:
    """Two lists taking turns in the same slot halve the gap until `MIN_GAP` forces a renumber.

    `MoveResult.positions` then carries every other list the renumbering rewrote, which is what
    the client writes into its cache instead of refetching the board (Sections 3.6 and 4.9).
    """
    board_id = empty_board["id"]
    _create(api, board_id, "Anchor")
    first = _create(api, board_id, "Leapfrog A")["item"]["id"]
    second = _create(api, board_id, "Leapfrog B")["item"]["id"]
    positions: dict[str, float] = {}
    for attempt in range(60):
        moving = first if attempt % 2 else second
        response = api.post(f"/api/lists/{moving}/move", json={"index": 1}, headers=CSRF_HEADERS)
        assert response.status_code == 200, response.text
        positions = response.json()["positions"]
        if positions:
            break
    assert positions, "60 midpoint inserts should have collapsed the gap below MIN_GAP"
    assert sorted(positions.values()) == [STEP, STEP * 2]  # the two lists that stayed put
    assert _names(api, board_id)[0] == "Anchor"
    assert sorted(_names(api, board_id)) == ["Anchor", "Leapfrog A", "Leapfrog B"]


# --------------------------------------------------------------------------- copy


def test_copy_duplicates_the_list_and_its_cards(
    api: TestClient, empty_board: dict[str, Any]
) -> None:
    board_id = empty_board["id"]
    source = _create(api, board_id, "Backlog", index=0)["item"]["id"]
    _create(api, board_id, "Done")
    api.patch(f"/api/lists/{source}", json={"color": "sky"}, headers=CSRF_HEADERS)
    _insert_cards(
        board_id,
        source,
        [{"title": "Plan"}, {"title": "Build"}, {"title": "Gone", "is_archived": 1}],
    )
    response = api.post(
        f"/api/lists/{source}/copy", json={"name": "Backlog (copy)"}, headers=CSRF_HEADERS
    )
    assert response.status_code == 201, response.text
    copy_id = response.json()["item"]["id"]
    assert response.json()["item"]["color"] == "sky"
    # The default index is directly after the source.
    assert _names(api, board_id) == ["Backlog", "Backlog (copy)", "Done"]
    assert [title for _id, title, _position, _archived in _card_rows(copy_id)] == ["Plan", "Build"]
    assert [row[3] for row in _card_rows(copy_id)] == [0, 0]
    assert [title for _id, title, _position, _archived in _card_rows(source)] == [
        "Plan",
        "Build",
        "Gone",
    ]
    types = _activity_types(board_id)
    assert types[-3:] == ["list.copied", "card.copied", "card.copied"]


def test_copied_cards_get_fresh_short_ids(api: TestClient, empty_board: dict[str, Any]) -> None:
    board_id = empty_board["id"]
    source = _create(api, board_id, "Backlog")["item"]["id"]
    _insert_cards(board_id, source, [{"title": "Plan"}, {"title": "Build"}])
    copy_id = api.post(
        f"/api/lists/{source}/copy", json={"name": "Copy"}, headers=CSRF_HEADERS
    ).json()["item"]["id"]
    session = db_module.SessionLocal()
    try:
        short_ids = (
            session.execute(
                select(Card.short_id).where(Card.board_id == board_id).order_by(Card.short_id)
            )
            .scalars()
            .all()
        )
    finally:
        session.rollback()
        session.close()
    assert list(short_ids) == [1, 2, 3, 4]
    assert len(_card_rows(copy_id)) == 2


def test_copying_an_archived_list_appends_the_copy(
    api: TestClient, empty_board: dict[str, Any]
) -> None:
    board_id = empty_board["id"]
    source = _create(api, board_id, "Backlog", index=0)["item"]["id"]
    _create(api, board_id, "Done")
    api.post(f"/api/lists/{source}/archive", headers=CSRF_HEADERS)
    response = api.post(f"/api/lists/{source}/copy", json={"name": "Copy"}, headers=CSRF_HEADERS)
    assert response.status_code == 201, response.text
    assert _names(api, board_id) == ["Done", "Copy"]


def test_copy_honours_an_explicit_index(api: TestClient, empty_board: dict[str, Any]) -> None:
    board_id = empty_board["id"]
    source = _create(api, board_id, "Backlog")["item"]["id"]
    _create(api, board_id, "Done")
    api.post(f"/api/lists/{source}/copy", json={"name": "Copy", "index": 0}, headers=CSRF_HEADERS)
    assert _names(api, board_id) == ["Copy", "Backlog", "Done"]


def test_copied_cards_keep_their_labels(api: TestClient, empty_board: dict[str, Any]) -> None:
    """A list copy never leaves the board, so the join row stays valid (Section 4.4).

    The cards of this module are inserted rather than composed (see the module docstring), so the
    `card_labels` row is written with SQL too; the copy itself still goes through
    `POST /api/lists/{list_id}/copy`.
    """
    board_id = empty_board["id"]
    source = _create(api, board_id, "Backlog")["item"]["id"]
    (card_id,) = _insert_cards(board_id, source, [{"title": "Tagged"}])
    label_id = api.get(f"/api/boards/{board_id}").json()["labels"][0]["id"]
    session = db_module.SessionLocal()
    try:
        with db_module.unversioned_write(session):
            session.add(CardLabel(card_id=card_id, label_id=label_id))
    finally:
        session.close()

    copy_id = api.post(
        f"/api/lists/{source}/copy", json={"name": "Copy"}, headers=CSRF_HEADERS
    ).json()["item"]["id"]

    (copied_card,) = (row[0] for row in _card_rows(copy_id))
    session = db_module.SessionLocal()
    try:
        labels = session.execute(
            select(CardLabel.label_id).where(CardLabel.card_id == copied_card)
        ).scalars()
        assert list(labels) == [label_id]
    finally:
        session.rollback()
        session.close()


# --------------------------------------------------------------------------- archive and delete


def test_archive_hides_the_list_and_unarchive_restores_its_slot(
    api: TestClient, board: dict[str, Any]
) -> None:
    """The archived list keeps its `position`, so "Send to board" restores the slot (3.6)."""
    doing = _lists(api, board["id"])[1]
    archived = api.post(f"/api/lists/{doing['id']}/archive", headers=CSRF_HEADERS)
    assert archived.status_code == 200, archived.text
    assert archived.json()["item"]["is_archived"] is True
    assert _names(api, board["id"]) == ["To Do", "Done"]
    restored = api.post(f"/api/lists/{doing['id']}/unarchive", headers=CSRF_HEADERS)
    assert restored.status_code == 200, restored.text
    assert restored.json()["item"]["is_archived"] is False
    assert restored.json()["item"]["position"] == doing["position"]
    assert _names(api, board["id"]) == ["To Do", "Doing", "Done"]
    assert _activity_types(board["id"])[-2:] == ["list.archived", "list.unarchived"]


def test_delete_is_409_before_archive_and_204_after(api: TestClient, board: dict[str, Any]) -> None:
    list_id = _lists(api, board["id"])[0]["id"]
    refused = api.delete(f"/api/lists/{list_id}", headers=CSRF_HEADERS)
    assert refused.status_code == 409, refused.text
    assert refused.json()["error"]["code"] == "conflict"
    assert refused.json()["error"]["details"] == {"list_id": list_id}
    api.post(f"/api/lists/{list_id}/archive", headers=CSRF_HEADERS)
    deleted = api.delete(f"/api/lists/{list_id}", headers=CSRF_HEADERS)
    assert deleted.status_code == 204, deleted.text
    assert api.delete(f"/api/lists/{list_id}", headers=CSRF_HEADERS).status_code == 404


def test_delete_cascades_the_cards(api: TestClient, empty_board: dict[str, Any]) -> None:
    list_id = _create(api, empty_board["id"], "Doomed")["item"]["id"]
    _insert_cards(empty_board["id"], list_id, [{"title": "Goes away"}])
    api.post(f"/api/lists/{list_id}/archive", headers=CSRF_HEADERS)
    assert api.delete(f"/api/lists/{list_id}", headers=CSRF_HEADERS).status_code == 204
    assert _card_rows(list_id) == []


# --------------------------------------------------------------------------- bulk card operations


def test_move_all_cards_appends_in_order_and_renumbers(
    api: TestClient, empty_board: dict[str, Any]
) -> None:
    board_id = empty_board["id"]
    source = _create(api, board_id, "To Do")["item"]["id"]
    target = _create(api, board_id, "Doing")["item"]["id"]
    _insert_cards(board_id, source, [{"title": "One"}, {"title": "Two"}])
    _insert_cards(board_id, target, [{"title": "Already there"}])
    response = api.post(
        f"/api/lists/{source}/move-all-cards", json={"to_list_id": target}, headers=CSRF_HEADERS
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["moved"] == 2
    assert sorted(body["positions"].values()) == [STEP, STEP * 2, STEP * 3]
    assert [title for _id, title, _position, _archived in _card_rows(target)] == [
        "Already there",
        "One",
        "Two",
    ]
    assert _card_rows(source) == []
    assert _activity_types(board_id)[-2:] == ["card.moved", "card.moved"]


def test_move_all_cards_refuses_another_board_and_itself(
    api: TestClient, empty_board: dict[str, Any], board_factory: BoardFactory
) -> None:
    source = _create(api, empty_board["id"], "To Do")["item"]["id"]
    foreign = _lists(api, board_factory("Elsewhere")["id"])[0]["id"]
    for to_list_id in (foreign, source):
        response = api.post(
            f"/api/lists/{source}/move-all-cards",
            json={"to_list_id": to_list_id},
            headers=CSRF_HEADERS,
        )
        assert response.status_code == 400, (to_list_id, response.text)


def test_move_all_cards_refuses_an_archived_destination(
    api: TestClient, empty_board: dict[str, Any]
) -> None:
    source = _create(api, empty_board["id"], "To Do")["item"]["id"]
    target = _create(api, empty_board["id"], "Doing")["item"]["id"]
    api.post(f"/api/lists/{target}/archive", headers=CSRF_HEADERS)
    response = api.post(
        f"/api/lists/{source}/move-all-cards", json={"to_list_id": target}, headers=CSRF_HEADERS
    )
    assert response.status_code == 400, response.text


def test_archive_all_cards_returns_the_ids_and_unarchive_cards_restores_them(
    api: TestClient, empty_board: dict[str, Any]
) -> None:
    """`archived_ids` is the Undo toast's payload and goes straight back (Section 4.4)."""
    board_id = empty_board["id"]
    list_id = _create(api, board_id, "To Do")["item"]["id"]
    card_ids = _insert_cards(board_id, list_id, [{"title": "One"}, {"title": "Two"}])
    archived = api.post(f"/api/lists/{list_id}/archive-all-cards", headers=CSRF_HEADERS)
    assert archived.status_code == 200, archived.text
    assert archived.json()["archived"] == 2
    assert archived.json()["archived_ids"] == card_ids
    assert _lists(api, board_id)[0]["card_count"] == 0
    assert _activity_types(board_id)[-2:] == ["card.archived", "card.archived"]

    restored = api.post(
        f"/api/lists/{list_id}/unarchive-cards",
        json={"card_ids": archived.json()["archived_ids"]},
        headers=CSRF_HEADERS,
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["restored"] == 2
    assert restored.json()["board_version"] == archived.json()["board_version"] + 1
    assert _lists(api, board_id)[0]["card_count"] == 2
    assert [row[2] for row in _card_rows(list_id)] == [STEP, STEP * 2]  # positions were kept
    assert _activity_types(board_id)[-2:] == ["card.unarchived", "card.unarchived"]


def test_unarchive_cards_ignores_ids_that_are_not_archived_cards_of_the_list(
    api: TestClient, empty_board: dict[str, Any]
) -> None:
    board_id = empty_board["id"]
    list_id = _create(api, board_id, "To Do")["item"]["id"]
    other_id = _create(api, board_id, "Doing")["item"]["id"]
    (active,) = _insert_cards(board_id, list_id, [{"title": "Active"}])
    (elsewhere,) = _insert_cards(board_id, other_id, [{"title": "Archived", "is_archived": 1}])
    response = api.post(
        f"/api/lists/{list_id}/unarchive-cards",
        json={"card_ids": [active, elsewhere, 9_999_999]},
        headers=CSRF_HEADERS,
    )
    assert response.status_code == 200, response.text
    assert response.json()["restored"] == 0


def test_unarchive_cards_refuses_a_card_of_another_board(
    api: TestClient, empty_board: dict[str, Any], board_factory: BoardFactory
) -> None:
    list_id = _create(api, empty_board["id"], "To Do")["item"]["id"]
    other = board_factory("Elsewhere")
    foreign_list = _lists(api, other["id"])[0]["id"]
    (foreign_card,) = _insert_cards(other["id"], foreign_list, [{"title": "Theirs"}])
    response = api.post(
        f"/api/lists/{list_id}/unarchive-cards",
        json={"card_ids": [foreign_card]},
        headers=CSRF_HEADERS,
    )
    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "bad_request"


def test_unarchive_cards_bounds_the_batch(api: TestClient, board: dict[str, Any]) -> None:
    list_id = _lists(api, board["id"])[0]["id"]
    for card_ids in ([], list(range(1, UNARCHIVE_CARDS_LIMIT + 2))):
        response = api.post(
            f"/api/lists/{list_id}/unarchive-cards",
            json={"card_ids": card_ids},
            headers=CSRF_HEADERS,
        )
        assert response.status_code == 422, response.text


# --------------------------------------------------------------------------- sort


def test_sort_by_name_reorders_the_cards(api: TestClient, empty_board: dict[str, Any]) -> None:
    board_id = empty_board["id"]
    list_id = _create(api, board_id, "To Do")["item"]["id"]
    _insert_cards(board_id, list_id, [{"title": "banana"}, {"title": "Apple"}, {"title": "cherry"}])
    response = api.post(f"/api/lists/{list_id}/sort", json={"by": "title"}, headers=CSRF_HEADERS)
    assert response.status_code == 200, response.text
    assert [title for _id, title, _position, _archived in _card_rows(list_id)] == [
        "Apple",
        "banana",
        "cherry",
    ]
    assert sorted(response.json()["positions"].values()) == [STEP, STEP * 2, STEP * 3]
    assert _activity_types(board_id)[-3:] == ["card.reordered"] * 3


@pytest.mark.parametrize(
    ("by", "expected"),
    [
        ("created_desc", ["Newest", "Middle", "Oldest"]),
        ("created_asc", ["Oldest", "Middle", "Newest"]),
        ("due", ["Middle", "Oldest", "Newest"]),
    ],
)
def test_sort_by_creation_and_due_date(
    api: TestClient, empty_board: dict[str, Any], by: str, expected: list[str]
) -> None:
    """`due` sorts cards without a due date last (Section 4.4)."""
    board_id = empty_board["id"]
    list_id = _create(api, board_id, f"Sort by {by}")["item"]["id"]
    _insert_cards(
        board_id,
        list_id,
        [
            {
                "title": "Oldest",
                "created_at": "2026-01-01T00:00:00.000Z",
                "due_at": "2026-05-01T00:00:00.000Z",
            },
            {
                "title": "Middle",
                "created_at": "2026-02-01T00:00:00.000Z",
                "due_at": "2026-03-01T00:00:00.000Z",
            },
            {"title": "Newest", "created_at": "2026-03-01T00:00:00.000Z"},
        ],
    )
    response = api.post(f"/api/lists/{list_id}/sort", json={"by": by}, headers=CSRF_HEADERS)
    assert response.status_code == 200, response.text
    assert [title for _id, title, _position, _archived in _card_rows(list_id)] == expected


def test_sort_rejects_an_unknown_order(api: TestClient, board: dict[str, Any]) -> None:
    list_id = _lists(api, board["id"])[0]["id"]
    response = api.post(f"/api/lists/{list_id}/sort", json={"by": "colour"}, headers=CSRF_HEADERS)
    assert response.status_code == 422, response.text


# --------------------------------------------------------------------------- access


def test_a_closed_board_refuses_list_mutations_but_still_reads(
    api: TestClient, board_factory: BoardFactory
) -> None:
    """The closed-board guard of Section 4.1 reaches the children through `board_access`."""
    closed = board_factory("Closing down")
    list_id = _lists(api, closed["id"])[0]["id"]
    assert api.post(f"/api/boards/{closed['id']}/close", headers=CSRF_HEADERS).status_code == 200
    refused = api.post(f"/api/lists/{list_id}/archive", headers=CSRF_HEADERS)
    assert refused.status_code == 409, refused.text
    assert refused.json()["error"]["message"] == "Board is closed"
    assert api.get(f"/api/boards/{closed['id']}/lists").status_code == 200


def test_an_unknown_list_is_404_for_every_verb(api: TestClient) -> None:
    """`list_access()` resolves the list's board first, so no id can be probed (Section 6.6)."""
    assert (
        api.patch("/api/lists/9999999", json={"name": "Ghost"}, headers=CSRF_HEADERS).status_code
        == 404
    )
    assert api.post("/api/lists/9999999/archive", headers=CSRF_HEADERS).status_code == 404
    assert api.delete("/api/lists/9999999", headers=CSRF_HEADERS).status_code == 404


# ------------------------------------------------- one version bump, one activity row per mutation


def _mutate_create(api: TestClient, board_id: int, list_id: int) -> Any:
    return api.post(f"/api/boards/{board_id}/lists", json={"name": "Fresh"}, headers=CSRF_HEADERS)


def _mutate_rename(api: TestClient, board_id: int, list_id: int) -> Any:
    return api.patch(f"/api/lists/{list_id}", json={"name": "Renamed"}, headers=CSRF_HEADERS)


def _mutate_color(api: TestClient, board_id: int, list_id: int) -> Any:
    return api.patch(f"/api/lists/{list_id}", json={"color": "pink"}, headers=CSRF_HEADERS)


def _mutate_move(api: TestClient, board_id: int, list_id: int) -> Any:
    return api.post(f"/api/lists/{list_id}/move", json={"index": 0}, headers=CSRF_HEADERS)


def _mutate_archive(api: TestClient, board_id: int, list_id: int) -> Any:
    return api.post(f"/api/lists/{list_id}/archive", headers=CSRF_HEADERS)


def _mutate_unarchive(api: TestClient, board_id: int, list_id: int) -> Any:
    return api.post(f"/api/lists/{list_id}/unarchive", headers=CSRF_HEADERS)


def _prepare_nothing(api: TestClient, board_id: int, list_id: int) -> None:
    """Most mutations need no set-up; only `/unarchive` needs an archived list first."""


def _prepare_archive(api: TestClient, board_id: int, list_id: int) -> None:
    assert _mutate_archive(api, board_id, list_id).status_code == 200


@pytest.mark.parametrize(
    ("prepare", "mutate", "expected_type"),
    [
        (_prepare_nothing, _mutate_create, "list.created"),
        (_prepare_nothing, _mutate_rename, "list.renamed"),
        (_prepare_nothing, _mutate_color, "list.color_changed"),
        (_prepare_nothing, _mutate_move, "list.moved"),
        (_prepare_nothing, _mutate_archive, "list.archived"),
        (_prepare_archive, _mutate_unarchive, "list.unarchived"),
    ],
)
def test_every_mutation_bumps_the_version_once_and_records_one_row(
    api: TestClient,
    board: dict[str, Any],
    prepare: Callable[[TestClient, int, int], None],
    mutate: Callable[[TestClient, int, int], Any],
    expected_type: str,
) -> None:
    """CLAUDE.md section 4: one `write_tx`, one version bump, one activity row per mutation."""
    board_id = board["id"]
    list_id = _lists(api, board_id)[2]["id"]
    prepare(api, board_id, list_id)
    before_version = _version(api, board_id)
    before_rows = len(_activity_types(board_id))
    response = mutate(api, board_id, list_id)
    assert response.status_code in (200, 201), response.text
    assert _version(api, board_id) == before_version + 1
    assert response.json()["board_version"] == before_version + 1
    types = _activity_types(board_id)
    assert len(types) == before_rows + 1
    assert types[-1] == expected_type
