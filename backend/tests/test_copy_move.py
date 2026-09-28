"""Card copy, cross-board move and the archived-items listing (Sections 4.5, 3.6, 3.7 and 4.3).

Three things are asserted here that no other module can assert:

* what a *copy* is - every `keep` flag on its own, rows of its own rather than shared ones, its own
  `short_id`, and the cover remapped onto the copied attachment;
* that a cross-board move is **one transaction spanning both boards** (Section 3.6): a fresh
  `short_id` on the target, labels dropped, members and watchers filtered to target-board members,
  `card.moved_out` / `card.moved_in` written with each board's own version, both versions bumped in
  the same COMMIT - and, when anything inside the transaction fails, *nothing* moved, so the card
  can never vanish from the source without appearing on the target;
* that `GET /api/boards/{board_id}/archived` lists the archived rows and only those.

Every fixture is built through the real API (CLAUDE.md section 6), and the last section drives each
of the four routes this milestone added or extended - `POST /api/cards/{card_id}/copy`, the
`to_board_id` of the card and list move bodies, and `CardDetail.attachments` - end to end. The
`keep`-flag matrix and the atomicity case above it call `services.cards` / `services.lists`
directly, the way `test_ordering.py` calls `ordering.py`: they assert stored columns, per-board
activity rows and a rollback injected mid-transaction, none of which a response body shows.
"""

import io
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from kanban.config import settings
from kanban.copy import EVERYTHING, Keep
from kanban.errors import BadRequest, Conflict, Forbidden
from kanban.models import Activity, Attachment, Board, Card, CardWatcher, Checklist, User
from kanban.services import cards as cards_service
from kanban.services import lists as lists_service
from tests.conftest import CSRF_HEADERS
from tests.test_cards import create_card, list_ids, register, session

BoardFactory = Callable[..., dict[str, Any]]
LoggedIn = tuple[TestClient, User]


# --------------------------------------------------------------------------- reading stored rows


def card_of(card_id: int) -> Any:
    """The stored columns of a card the copy and move contracts are written in terms of."""
    for db in session():
        return db.execute(
            select(
                Card.id,
                Card.board_id,
                Card.list_id,
                Card.short_id,
                Card.title,
                Card.description,
                Card.position,
                Card.cover_type,
                Card.cover_value,
                Card.is_template,
            ).where(Card.id == card_id)
        ).one()
    raise AssertionError("unreachable")  # pragma: no cover


def version_of(board_id: int) -> int:
    """`boards.version`, read straight from the row so no board payload is needed."""
    for db in session():
        return int(db.execute(select(Board.version).where(Board.id == board_id)).scalar_one())
    raise AssertionError("unreachable")  # pragma: no cover


def activities_of(board_id: int) -> list[Any]:
    """Every activity row of a board, newest last, with the columns the two feeds read."""
    for db in session():
        return list(
            db.execute(
                select(
                    Activity.type,
                    Activity.board_id,
                    Activity.card_id,
                    Activity.list_id,
                    Activity.board_version,
                    Activity.data,
                )
                .where(Activity.board_id == board_id)
                .order_by(Activity.id)
            ).all()
        )
    raise AssertionError("unreachable")  # pragma: no cover


def types_of(board_id: int) -> list[str]:
    """The activity types recorded on a board, in order."""
    return [row.type for row in activities_of(board_id)]


def watchers_of(card_id: int) -> list[int]:
    """The user ids watching a card."""
    for db in session():
        return sorted(
            db.execute(select(CardWatcher.user_id).where(CardWatcher.card_id == card_id)).scalars()
        )
    raise AssertionError("unreachable")  # pragma: no cover


def attachments_of(card_id: int) -> list[Any]:
    """The card's attachment rows with the three columns a file copy has to retarget."""
    for db in session():
        return list(
            db.execute(
                select(
                    Attachment.id,
                    Attachment.name,
                    Attachment.kind,
                    Attachment.url,
                    Attachment.file_path,
                    Attachment.thumb_path,
                    Attachment.dominant_color,
                )
                .where(Attachment.card_id == card_id)
                .order_by(Attachment.id)
            ).all()
        )
    raise AssertionError("unreachable")  # pragma: no cover


def checklist_ids_of(card_id: int) -> list[int]:
    """The card's checklist ids, so a copy can be shown not to share rows with its source."""
    for db in session():
        return sorted(
            db.execute(select(Checklist.id).where(Checklist.card_id == card_id)).scalars()
        )
    raise AssertionError("unreachable")  # pragma: no cover


# --------------------------------------------------------------------------- building a rich card


def detail(api: TestClient, card_id: int) -> dict[str, Any]:
    """`GET /api/cards/{card_id}`: the `CardDetail` every assertion about children reads."""
    response = api.get(f"/api/cards/{card_id}")
    assert response.status_code == 200, response.text
    return response.json()


def label_ids(api: TestClient, board_id: int) -> list[int]:
    """The six labels every new board is seeded with (Section 4.3)."""
    response = api.get(f"/api/boards/{board_id}/labels")
    assert response.status_code == 200, response.text
    return [label["id"] for label in response.json()["items"]]


def add_member(api: TestClient, board_id: int, user_id: int, role: str = "member") -> None:
    """`PUT /api/boards/{board_id}/members/{user_id}`."""
    response = api.put(
        f"/api/boards/{board_id}/members/{user_id}", json={"role": role}, headers=CSRF_HEADERS
    )
    assert response.status_code == 200, response.text


def add_checklist(api: TestClient, card_id: int, name: str, items: list[str]) -> int:
    """A checklist with `items`, the first of them ticked, through the M3 endpoints."""
    response = api.post(
        f"/api/cards/{card_id}/checklists", json={"name": name}, headers=CSRF_HEADERS
    )
    assert response.status_code == 201, response.text
    checklist_id = response.json()["item"]["id"]
    for offset, item in enumerate(items):
        created = api.post(
            f"/api/checklists/{checklist_id}/items", json={"name": item}, headers=CSRF_HEADERS
        )
        assert created.status_code == 201, created.text
        if offset == 0:
            ticked = api.patch(
                f"/api/checklist-items/{created.json()['item']['id']}",
                json={"is_checked": True},
                headers=CSRF_HEADERS,
            )
            assert ticked.status_code == 200, ticked.text
    return int(checklist_id)


def add_comment(api: TestClient, card_id: int, body: str) -> int:
    """`POST /api/cards/{card_id}/comments`."""
    response = api.post(f"/api/cards/{card_id}/comments", json={"body": body}, headers=CSRF_HEADERS)
    assert response.status_code == 201, response.text
    return int(response.json()["item"]["id"])


def png_bytes(color: tuple[int, int, int] = (12, 140, 233)) -> bytes:
    """A real one-colour PNG, so the upload route stores a file and a thumbnail of its own."""
    buffer = io.BytesIO()
    Image.new("RGB", (24, 12), color).save(buffer, format="PNG")
    return buffer.getvalue()


def add_upload_attachment(api: TestClient, card_id: int, name: str = "photo.png") -> int:
    """`POST /api/cards/{card_id}/attachments` with a real PNG (Sections 4.6 and 6.9).

    The copy contract of Section 4.5 says "attachment files are copied on disk", so the source
    needs a row *and* the two files the upload route writes beside it; this goes through that route
    rather than inserting the row, as CLAUDE.md section 6 requires.
    """
    response = api.post(
        f"/api/cards/{card_id}/attachments",
        files={"file": (name, png_bytes(), "image/png")},
        headers=CSRF_HEADERS,
    )
    assert response.status_code == 201, response.text
    return int(response.json()["item"]["id"])


def set_attachment_cover(api: TestClient, card_id: int, attachment_id: int) -> None:
    """`PUT /api/cards/{card_id}/cover` with one of the card's image attachments (Section 4.5)."""
    response = api.put(
        f"/api/cards/{card_id}/cover",
        json={"kind": "attachment", "value": attachment_id},
        headers=CSRF_HEADERS,
    )
    assert response.status_code == 200, response.text


def add_watcher(api: TestClient, card_id: int) -> None:
    """`PUT /api/cards/{card_id}/watch`: the caller watches the card (Section 4.5).

    Watching is per-user state with no "watch on somebody's behalf" form, so each watcher of a card
    is added by its own signed-in client.
    """
    response = api.put(f"/api/cards/{card_id}/watch", headers=CSRF_HEADERS)
    assert response.status_code == 200, response.text
    assert response.json() == {"is_watching": True}


@pytest.fixture(scope="module")
def sessions(client: TestClient) -> dict[str, tuple[TestClient, dict[str, Any]]]:
    """The extra accounts this module adds to its boards, each with its own signed-in client.

    Module scope because the database file is per module (conftest) while every test gets a fresh
    board: registering the same username again would answer 409. The clients are kept because
    watching is per-user state a second account can only set for itself (Section 4.5).
    """
    return {name: register(client, name) for name in ("member", "shared", "local")}


@pytest.fixture(scope="module")
def accounts(
    sessions: dict[str, tuple[TestClient, dict[str, Any]]],
) -> dict[str, dict[str, Any]]:
    """Just the `UserOut` of each extra account, which is all most tests need."""
    return {name: account for name, (_client, account) in sessions.items()}


@pytest.fixture(scope="module")
def stranger(client: TestClient) -> tuple[TestClient, dict[str, Any]]:
    """A signed-in client that is a member of no board here, plus a board of its own.

    Every 403 in this module aims at that board and none of them may touch it, which is what the
    `version == 1` assertion checks.
    """
    other, _account = register(client, "stranger")
    response = other.post("/api/boards", json={"name": "Private"}, headers=CSRF_HEADERS)
    assert response.status_code == 201, response.text
    return other, response.json()


@pytest.fixture
def lists(board: dict[str, Any]) -> list[int]:
    """The seeded `To Do` / `Doing` / `Done` list ids of the module's board."""
    return list_ids(board["id"])


@pytest.fixture
def other_board(board_factory: BoardFactory) -> dict[str, Any]:
    """A second board of the same owner, for the cross-board move and copy."""
    return board_factory("Ops")


@pytest.fixture
def rich_card(
    logged_in: LoggedIn,
    board: dict[str, Any],
    lists: list[int],
    accounts: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """A card carrying one of everything a `keep` flag can bring along."""
    api, _user = logged_in
    account = accounts["member"]
    add_member(api, board["id"], account["id"])
    card = create_card(
        api,
        lists[0],
        "Write plan",
        label_ids=label_ids(api, board["id"])[:2],
        member_ids=[account["id"]],
    )["item"]
    patched = api.patch(
        f"/api/cards/{card['id']}",
        json={"description": "the original description", "due_at": "2026-09-30T15:00:00.000Z"},
        headers=CSRF_HEADERS,
    )
    assert patched.status_code == 200, patched.text
    add_checklist(api, card["id"], "Steps", ["Draft", "Review"])
    add_comment(api, card["id"], "Looks good, ship it")
    return {**card, "member_id": account["id"]}


def copy_of(
    db: Any, user: User, card_id: int, to_list_id: int, *, board_id: int, **kwargs: Any
) -> dict[str, Any]:
    """`services.cards.copy_card`, returning the `CardSummary` it answers with."""
    return cards_service.copy_card(
        db, user, board_id=board_id, card_id=card_id, to_list_id=to_list_id, **kwargs
    ).item


# --------------------------------------------------------------------------- copy: the keep flags


def test_a_copy_with_no_keep_flags_carries_the_card_and_nothing_else(
    logged_in: LoggedIn, db: Any, board: dict[str, Any], lists: list[int], rich_card: dict[str, Any]
) -> None:
    api, user = logged_in

    item = copy_of(
        db, user, rich_card["id"], lists[1], board_id=board["id"], title="Write plan copy"
    )

    copy = detail(api, item["id"])
    assert copy["title"] == "Write plan copy"
    assert copy["description"] == "the original description"  # the card itself always comes along
    assert copy["due_at"] == "2026-09-30T15:00:00.000Z"
    assert copy["list_id"] == lists[1]
    assert (copy["label_ids"], copy["member_ids"], copy["checklists"]) == ([], [], [])
    assert copy["badges"]["comments"] == 0
    assert copy["badges"]["checklist_total"] == 0


@pytest.mark.parametrize(
    ("flag", "field", "expected"),
    [
        ("labels", "label_ids", 2),
        ("members", "member_ids", 1),
        ("checklists", "checklist_total", 2),
        ("comments", "comments", 1),
    ],
)
def test_each_keep_flag_brings_exactly_its_own_children(
    logged_in: LoggedIn,
    db: Any,
    board: dict[str, Any],
    lists: list[int],
    rich_card: dict[str, Any],
    flag: str,
    field: str,
    expected: int,
) -> None:
    api, user = logged_in

    item = copy_of(
        db,
        user,
        rich_card["id"],
        lists[1],
        board_id=board["id"],
        title=f"Keeping {flag}",
        keep=Keep(**{flag: True}),
    )

    copy = detail(api, item["id"])
    counts = {
        "label_ids": len(copy["label_ids"]),
        "member_ids": len(copy["member_ids"]),
        "checklist_total": copy["badges"]["checklist_total"],
        "comments": copy["badges"]["comments"],
    }
    assert counts[field] == expected
    assert sum(counts.values()) == expected  # nothing else came with it


def test_keeping_everything_brings_every_child_including_the_checked_state(
    logged_in: LoggedIn, db: Any, board: dict[str, Any], lists: list[int], rich_card: dict[str, Any]
) -> None:
    api, user = logged_in

    item = copy_of(
        db,
        user,
        rich_card["id"],
        lists[1],
        board_id=board["id"],
        title="Everything",
        keep=EVERYTHING,
    )

    copy = detail(api, item["id"])
    assert len(copy["label_ids"]) == 2
    assert copy["member_ids"] == [rich_card["member_id"]]
    assert copy["badges"] == {
        "description": True,
        "comments": 1,
        "attachments": 0,
        "checklist_done": 1,
        "checklist_total": 2,
    }
    items = copy["checklists"][0]["items"]
    assert [item["name"] for item in items] == ["Draft", "Review"]
    assert [item["is_checked"] for item in items] == [True, False]


def test_a_copy_does_not_share_checklist_rows_with_its_source(
    logged_in: LoggedIn, db: Any, board: dict[str, Any], lists: list[int], rich_card: dict[str, Any]
) -> None:
    api, user = logged_in

    item = copy_of(
        db,
        user,
        rich_card["id"],
        lists[1],
        board_id=board["id"],
        title="Own rows",
        keep=Keep(checklists=True),
    )

    source_ids = checklist_ids_of(rich_card["id"])
    copy_ids = checklist_ids_of(item["id"])
    assert set(source_ids).isdisjoint(copy_ids)
    ticked = api.patch(
        f"/api/checklist-items/{detail(api, item['id'])['checklists'][0]['items'][1]['id']}",
        json={"is_checked": True},
        headers=CSRF_HEADERS,
    )
    assert ticked.status_code == 200, ticked.text
    assert detail(api, item["id"])["badges"]["checklist_done"] == 2
    assert detail(api, rich_card["id"])["badges"]["checklist_done"] == 1  # untouched


def test_a_copy_gets_its_own_short_id_and_lands_at_the_requested_index(
    logged_in: LoggedIn, db: Any, board: dict[str, Any], lists: list[int]
) -> None:
    api, user = logged_in
    first = create_card(api, lists[1], "First")["item"]
    second = create_card(api, lists[1], "Second")["item"]
    source = create_card(api, lists[0], "Source")["item"]

    item = copy_of(db, user, source["id"], lists[1], board_id=board["id"], title="Copy", index=1)

    assert item["short_id"] == source["short_id"] + 1 == 4
    assert first["position"] < item["position"] < second["position"]


def test_a_copy_records_card_copied_and_one_comment_added_per_comment(
    logged_in: LoggedIn, db: Any, board: dict[str, Any], lists: list[int], rich_card: dict[str, Any]
) -> None:
    api, user = logged_in

    item = copy_of(
        db,
        user,
        rich_card["id"],
        lists[1],
        board_id=board["id"],
        title="Copy with comments",
        keep=Keep(comments=True),
    )

    feed = api.get(f"/api/cards/{item['id']}/feed", params={"details": 1})
    assert feed.status_code == 200, feed.text
    entries = feed.json()["items"]
    # The copied comment is visible in the modal, which is only true if it got its own row.
    assert [entry["kind"] for entry in entries] == ["comment", "activity"]
    assert entries[0]["comment"]["body"] == "Looks good, ship it"
    copied = entries[1]["activity"]
    assert copied["type"] == "card.copied"
    assert copied["data"]["source_card_id"] == rich_card["id"]
    assert copied["data"]["source_list_name"] == "To Do"
    assert copied["data"]["list_name"] == "Doing"


def test_is_template_overrides_the_sources_flag_for_create_from_template(
    logged_in: LoggedIn, db: Any, board: dict[str, Any], lists: list[int]
) -> None:
    api, user = logged_in
    source = create_card(api, lists[0], "Template")["item"]
    made = api.patch(f"/api/cards/{source['id']}", json={"is_template": True}, headers=CSRF_HEADERS)
    assert made.status_code == 200, made.text

    inherited = copy_of(db, user, source["id"], lists[0], board_id=board["id"], title="Another")
    plain = copy_of(
        db, user, source["id"], lists[0], board_id=board["id"], title="Real", is_template=False
    )

    assert inherited["is_template"] is True
    assert plain["is_template"] is False


# --------------------------------------------------------------------------- copy: attachments


def test_keeping_attachments_copies_the_row_the_files_and_the_cover(
    logged_in: LoggedIn, db: Any, board: dict[str, Any], lists: list[int]
) -> None:
    _api, user = logged_in
    source = create_card(api=_api, list_id=lists[0], title="With an image")["item"]
    attachment_id = add_upload_attachment(_api, source["id"])
    set_attachment_cover(_api, source["id"], attachment_id)

    item = copy_of(
        db,
        user,
        source["id"],
        lists[1],
        board_id=board["id"],
        title="Copy with the image",
        keep=Keep(attachments=True),
    )

    copied = attachments_of(item["id"])
    assert len(copied) == 1
    row = copied[0]
    assert row.id != attachment_id
    assert row.file_path == f"attachments/{row.id}/photo.png"
    assert row.url == f"/uploads/attachments/{row.id}/photo.png"
    assert row.thumb_path == f"attachments/{row.id}/thumb.jpg"
    source_directory: Path = settings.uploads_dir / "attachments" / str(attachment_id)
    directory: Path = settings.uploads_dir / "attachments" / str(row.id)
    for file_name in ("photo.png", "thumb.jpg"):
        assert (directory / file_name).read_bytes() == (source_directory / file_name).read_bytes()
    # The cover followed the copied attachment rather than pointing at the source's row, and
    # carries that row's own thumbnail (`services.cards._cover` resolves it, Section 4.5).
    assert item["cover"] == {
        "kind": "attachment",
        "value": str(row.id),
        "size": "normal",
        "image_url": f"/uploads/attachments/{row.id}/thumb.jpg",
        "dominant_color": row.dominant_color,
    }
    assert row.dominant_color is not None


def test_a_copy_without_the_attachments_has_no_attachment_cover(
    logged_in: LoggedIn, db: Any, board: dict[str, Any], lists: list[int]
) -> None:
    api, user = logged_in
    source = create_card(api, lists[0], "Covered")["item"]
    set_attachment_cover(api, source["id"], add_upload_attachment(api, source["id"], "shot.png"))

    item = copy_of(db, user, source["id"], lists[1], board_id=board["id"], title="Uncovered")

    assert item["cover"] is None
    assert attachments_of(item["id"]) == []
    assert card_of(source["id"]).cover_type == "attachment"  # the source keeps its own


# --------------------------------------------------------------------------- copy: across boards


def test_a_cross_board_copy_drops_labels_and_members_and_renumbers(
    logged_in: LoggedIn,
    db: Any,
    board: dict[str, Any],
    lists: list[int],
    other_board: dict[str, Any],
    rich_card: dict[str, Any],
) -> None:
    api, user = logged_in
    target_list = list_ids(other_board["id"])[0]
    before = version_of(board["id"])

    item = copy_of(
        db,
        user,
        rich_card["id"],
        target_list,
        board_id=board["id"],
        title="Copied across",
        keep=EVERYTHING,
    )

    copy = detail(api, item["id"])
    assert copy["board_id"] == other_board["id"]
    assert (copy["label_ids"], copy["member_ids"]) == ([], [])  # both are per board
    assert copy["badges"]["checklist_total"] == 2  # checklists still travel
    assert copy["short_id"] == 1  # the target board's own sequence
    assert version_of(board["id"]) == before  # a copy changes nothing on the source board
    assert types_of(other_board["id"])[-2:] == ["card.copied", "comment.added"]


def test_a_copy_into_a_board_the_caller_is_not_a_member_of_is_403(
    logged_in: LoggedIn,
    db: Any,
    board: dict[str, Any],
    lists: list[int],
    stranger: tuple[TestClient, dict[str, Any]],
) -> None:
    api, user = logged_in
    _client, theirs = stranger
    card = create_card(api, lists[0], "Not yours")["item"]

    with pytest.raises(Forbidden):
        copy_of(
            db,
            user,
            card["id"],
            list_ids(theirs["id"])[0],
            board_id=board["id"],
            title="Sneaky",
        )


def test_a_copy_into_a_closed_board_is_409(
    logged_in: LoggedIn,
    db: Any,
    board: dict[str, Any],
    lists: list[int],
    other_board: dict[str, Any],
) -> None:
    api, user = logged_in
    card = create_card(api, lists[0], "Too late")["item"]
    closed = api.post(f"/api/boards/{other_board['id']}/close", headers=CSRF_HEADERS)
    assert closed.status_code == 200, closed.text

    with pytest.raises(Conflict):
        copy_of(
            db,
            user,
            card["id"],
            list_ids(other_board["id"])[0],
            board_id=board["id"],
            title="Into a closed board",
        )


def test_a_copy_into_a_list_that_does_not_exist_is_400(
    logged_in: LoggedIn, db: Any, board: dict[str, Any], lists: list[int]
) -> None:
    api, user = logged_in
    card = create_card(api, lists[0], "Nowhere")["item"]

    with pytest.raises(BadRequest):
        copy_of(db, user, card["id"], 9_999_999, board_id=board["id"], title="Nowhere")


# --------------------------------------------------------------------------- the cross-board move


def moved_across(
    db: Any,
    user: User,
    card_id: int,
    *,
    board_id: int,
    to_board_id: int,
    to_list_id: int,
    index: int = 0,
) -> Any:
    """`services.cards.move_card` with the `to_board_id` of Sections 4.5 and 3.6."""
    return cards_service.move_card(
        db,
        user,
        board_id=board_id,
        card_id=card_id,
        to_list_id=to_list_id,
        index=index,
        to_board_id=to_board_id,
    )


def test_a_cross_board_move_strips_labels_keeps_only_target_members_and_renumbers(
    logged_in: LoggedIn,
    db: Any,
    board: dict[str, Any],
    lists: list[int],
    other_board: dict[str, Any],
    accounts: dict[str, dict[str, Any]],
    sessions: dict[str, tuple[TestClient, dict[str, Any]]],
) -> None:
    api, user = logged_in
    shared, local = accounts["shared"], accounts["local"]
    add_member(api, board["id"], shared["id"])
    add_member(api, board["id"], local["id"])
    add_member(api, other_board["id"], shared["id"])
    card = create_card(
        api,
        lists[0],
        "Travelling",
        label_ids=label_ids(api, board["id"])[:1],
        member_ids=[shared["id"], local["id"]],
    )["item"]
    add_watcher(sessions["local"][0], card["id"])
    add_watcher(api, card["id"])
    create_card(api, list_ids(other_board["id"])[0], "Already there")  # takes short_id 1
    target_list = list_ids(other_board["id"])[0]
    source_version, target_version = version_of(board["id"]), version_of(other_board["id"])

    result = moved_across(
        db,
        user,
        card["id"],
        board_id=board["id"],
        to_board_id=other_board["id"],
        to_list_id=target_list,
    )

    stored = card_of(card["id"])
    assert (stored.board_id, stored.list_id) == (other_board["id"], target_list)
    assert stored.short_id == 2  # MAX(short_id) + 1 of the *target* board
    summary = result.item
    assert summary["label_ids"] == []  # labels are per board
    assert summary["member_ids"] == [shared["id"]]  # the local-only member is dropped
    assert watchers_of(card["id"]) == sorted([user.id])  # and so is the local-only watcher
    # Both versions were bumped by the one COMMIT, and the response carries the target's.
    assert version_of(board["id"]) == source_version + 1
    assert version_of(other_board["id"]) == target_version + 1
    assert result.board_version == target_version + 1


def test_a_cross_board_move_writes_one_activity_row_on_each_board(
    logged_in: LoggedIn,
    db: Any,
    board: dict[str, Any],
    lists: list[int],
    other_board: dict[str, Any],
) -> None:
    api, user = logged_in
    card = create_card(api, lists[0], "Two rows")["item"]
    target_list = list_ids(other_board["id"])[1]

    moved_across(
        db,
        user,
        card["id"],
        board_id=board["id"],
        to_board_id=other_board["id"],
        to_list_id=target_list,
    )

    out = activities_of(board["id"])[-1]
    into = activities_of(other_board["id"])[-1]
    assert (out.type, into.type) == ("card.moved_out", "card.moved_in")
    assert out.board_version == version_of(board["id"])
    assert into.board_version == version_of(other_board["id"])
    assert out.card_id == into.card_id == card["id"]
    assert out.list_id == lists[0] and into.list_id == target_list
    assert f'"other_board_id":{other_board["id"]}' in out.data
    assert f'"other_board_id":{board["id"]}' in into.data
    assert "Ops" in out.data and "Sprint 42" in into.data


def test_a_cross_board_move_is_atomic_when_the_transaction_fails(
    logged_in: LoggedIn,
    db: Any,
    board: dict[str, Any],
    lists: list[int],
    other_board: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The card can never vanish from the source without appearing on the target (Section 3.6).

    The failure is injected on the *second* of the two activity rows, i.e. after the card row has
    already been handed to the target board inside the transaction: one `write_tx` spanning both
    boards means that write is rolled back with everything else.
    """
    api, user = logged_in
    card = create_card(api, lists[0], "Stays put", label_ids=label_ids(api, board["id"])[:1])[
        "item"
    ]
    target_list = list_ids(other_board["id"])[0]
    before = card_of(card["id"])
    versions = (version_of(board["id"]), version_of(other_board["id"]))
    real_record = cards_service.activity.record

    def failing_record(ctx: Any, type: str, *args: Any, **kwargs: Any) -> Any:
        if type == "card.moved_in":
            raise RuntimeError("the target write fails")
        return real_record(ctx, type, *args, **kwargs)

    monkeypatch.setattr(cards_service.activity, "record", failing_record)

    with pytest.raises(RuntimeError):
        moved_across(
            db,
            user,
            card["id"],
            board_id=board["id"],
            to_board_id=other_board["id"],
            to_list_id=target_list,
        )

    monkeypatch.undo()
    after = card_of(card["id"])
    assert (after.board_id, after.list_id, after.short_id) == (
        before.board_id,
        before.list_id,
        before.short_id,
    )
    assert detail(api, card["id"])["label_ids"] != []  # the label deletion rolled back too
    assert (version_of(board["id"]), version_of(other_board["id"])) == versions
    assert "card.moved_out" not in types_of(board["id"])
    assert "card.moved_in" not in types_of(other_board["id"])


def test_a_move_to_a_board_the_caller_is_not_a_member_of_is_403(
    logged_in: LoggedIn,
    db: Any,
    board: dict[str, Any],
    lists: list[int],
    stranger: tuple[TestClient, dict[str, Any]],
) -> None:
    api, user = logged_in
    _client, theirs = stranger
    card = create_card(api, lists[0], "Not going there")["item"]

    with pytest.raises(Forbidden):
        moved_across(
            db,
            user,
            card["id"],
            board_id=board["id"],
            to_board_id=theirs["id"],
            to_list_id=list_ids(theirs["id"])[0],
        )

    assert card_of(card["id"]).board_id == board["id"]
    assert version_of(theirs["id"]) == 1  # the transaction never opened on their board


def test_a_move_whose_target_list_is_not_on_the_target_board_is_400(
    logged_in: LoggedIn,
    db: Any,
    board: dict[str, Any],
    lists: list[int],
    other_board: dict[str, Any],
) -> None:
    api, user = logged_in
    card = create_card(api, lists[0], "Mismatched")["item"]

    with pytest.raises(BadRequest):
        moved_across(
            db,
            user,
            card["id"],
            board_id=board["id"],
            to_board_id=other_board["id"],
            to_list_id=lists[1],  # a list of the *source* board
        )


def test_a_move_naming_the_cards_own_board_stays_an_ordinary_move(
    logged_in: LoggedIn, db: Any, board: dict[str, Any], lists: list[int]
) -> None:
    api, user = logged_in
    card = create_card(api, lists[0], "Same board")["item"]

    result = moved_across(
        db,
        user,
        card["id"],
        board_id=board["id"],
        to_board_id=board["id"],
        to_list_id=lists[1],
    )

    assert result.item["short_id"] == card["short_id"]  # no renumbering
    assert types_of(board["id"])[-1] == "card.moved"


# --------------------------------------------------------------------------- the list move


def test_a_cross_board_list_move_takes_its_cards_with_it(
    logged_in: LoggedIn,
    db: Any,
    board: dict[str, Any],
    lists: list[int],
    other_board: dict[str, Any],
    accounts: dict[str, dict[str, Any]],
) -> None:
    api, user = logged_in
    local = accounts["local"]
    add_member(api, board["id"], local["id"])
    first = create_card(
        api,
        lists[0],
        "Keeps travelling",
        label_ids=label_ids(api, board["id"])[:1],
        member_ids=[local["id"]],
    )["item"]
    second = create_card(api, lists[0], "Second")["item"]
    archived = create_card(api, lists[0], "Archived but attached")["item"]
    assert api.post(f"/api/cards/{archived['id']}/archive", headers=CSRF_HEADERS).status_code == 200
    create_card(api, list_ids(other_board["id"])[0], "Already there")  # short_id 1 over there
    source_version, target_version = version_of(board["id"]), version_of(other_board["id"])

    item, _positions, board_version = lists_service.move_list(
        db,
        user,
        list_id=lists[0],
        board_id=board["id"],
        index=0,
        to_board_id=other_board["id"],
    )

    assert item["board_id"] == other_board["id"]
    moved = [card_of(card["id"]) for card in (first, second, archived)]
    assert {card.board_id for card in moved} == {other_board["id"]}
    assert sorted(card.short_id for card in moved) == [2, 3, 4]  # the target board's sequence
    assert detail(api, first["id"])["label_ids"] == []
    assert detail(api, first["id"])["member_ids"] == []  # not a member of the target board
    assert version_of(board["id"]) == source_version + 1
    assert version_of(other_board["id"]) == target_version + 1
    assert board_version == target_version + 1
    assert types_of(board["id"])[-1] == "list.moved_out"
    assert types_of(other_board["id"])[-1] == "list.moved_in"


def test_a_list_move_to_a_board_the_caller_is_not_a_member_of_is_403(
    logged_in: LoggedIn,
    db: Any,
    board: dict[str, Any],
    lists: list[int],
    stranger: tuple[TestClient, dict[str, Any]],
) -> None:
    _api, user = logged_in
    _client, theirs = stranger

    with pytest.raises(Forbidden):
        lists_service.move_list(
            db, user, list_id=lists[0], board_id=board["id"], index=0, to_board_id=theirs["id"]
        )


def test_a_list_move_naming_its_own_board_still_reorders(
    logged_in: LoggedIn, db: Any, board: dict[str, Any], lists: list[int]
) -> None:
    _api, user = logged_in

    item, _positions, _version = lists_service.move_list(
        db, user, list_id=lists[2], board_id=board["id"], index=0, to_board_id=board["id"]
    )

    assert item["board_id"] == board["id"]
    assert list_ids(board["id"])[0] == lists[2]
    assert types_of(board["id"])[-1] == "list.moved"


# --------------------------------------------------------------------------- the archived listing


def archived(api: TestClient, board_id: int, **params: Any) -> dict[str, Any]:
    """`GET /api/boards/{board_id}/archived` (Section 4.3)."""
    response = api.get(f"/api/boards/{board_id}/archived", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_the_archived_listing_returns_archived_cards_and_excludes_active_ones(
    logged_in: LoggedIn, board: dict[str, Any], lists: list[int]
) -> None:
    api, _user = logged_in
    active = create_card(api, lists[0], "Still on the board")["item"]
    gone = create_card(api, lists[0], "Archived card")["item"]
    assert api.post(f"/api/cards/{gone['id']}/archive", headers=CSRF_HEADERS).status_code == 200
    in_archived_list = create_card(api, lists[1], "Inside an archived list")["item"]
    assert api.post(f"/api/lists/{lists[1]}/archive", headers=CSRF_HEADERS).status_code == 200

    page = archived(api, board["id"])

    ids = [item["id"] for item in page["items"]]
    assert ids == [gone["id"]]
    assert active["id"] not in ids
    # A card inside an archived list is not archived itself: it comes back with the list (3.7).
    assert in_archived_list["id"] not in ids
    assert page["items"][0]["is_archived"] is True
    assert page["items"][0]["badges"]["comments"] == 0  # a full CardSummary
    assert page["next_before"] is None


def test_the_archived_listing_returns_archived_lists_for_type_lists(
    logged_in: LoggedIn, board: dict[str, Any], lists: list[int]
) -> None:
    api, _user = logged_in
    assert api.post(f"/api/lists/{lists[2]}/archive", headers=CSRF_HEADERS).status_code == 200

    page = archived(api, board["id"], type="lists")

    assert [item["id"] for item in page["items"]] == [lists[2]]
    assert page["items"][0]["is_archived"] is True
    assert page["items"][0]["name"] == "Done"
    assert archived(api, board["id"], type="cards")["items"] == []


def test_the_archived_listing_filters_by_q_and_pages_with_next_before(
    logged_in: LoggedIn, board: dict[str, Any], lists: list[int]
) -> None:
    api, _user = logged_in
    ids = []
    for title in ("Alpha report", "Beta report", "Gamma note"):
        card = create_card(api, lists[0], title)["item"]
        assert api.post(f"/api/cards/{card['id']}/archive", headers=CSRF_HEADERS).status_code == 200
        ids.append(card["id"])

    matching = archived(api, board["id"], q="REPORT")
    first = archived(api, board["id"], limit=1)
    second = archived(api, board["id"], limit=1, before=first["next_before"])

    assert [item["title"] for item in matching["items"]] == ["Beta report", "Alpha report"]
    assert [item["id"] for item in first["items"]] == [ids[2]]  # newest first
    assert first["next_before"] == ids[2]
    assert [item["id"] for item in second["items"]] == [ids[1]]


def test_the_archived_listing_needs_a_member_and_a_known_type(
    logged_in: LoggedIn, board: dict[str, Any], stranger: tuple[TestClient, dict[str, Any]]
) -> None:
    api, _user = logged_in
    outsider, _theirs = stranger

    assert outsider.get(f"/api/boards/{board['id']}/archived").status_code == 404
    unknown = api.get(f"/api/boards/{board['id']}/archived", params={"type": "boards"})
    assert unknown.status_code == 422


# --------------------------------------------------------------- over HTTP: the routes themselves


def test_the_copy_route_answers_201_with_the_new_card_and_honours_keep(
    logged_in: LoggedIn, board: dict[str, Any], rich_card: dict[str, Any], lists: list[int]
) -> None:
    api, _user = logged_in
    source = detail(api, rich_card["id"])
    version = version_of(board["id"])

    response = api.post(
        f"/api/cards/{rich_card['id']}/copy",
        json={
            "title": "Copied over HTTP",
            "to_list_id": lists[1],
            "index": 0,
            "keep": {"checklists": True, "labels": True},
        },
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 201, response.text
    body = response.json()
    item = body["item"]
    assert item["id"] != rich_card["id"]
    assert item["title"] == "Copied over HTTP"
    assert item["list_id"] == lists[1]
    assert item["short_id"] == source["short_id"] + 1
    assert item["label_ids"] == source["label_ids"]  # kept
    assert item["member_ids"] == []  # the flag was not sent, so it defaults to false
    assert item["badges"]["checklist_total"] == source["badges"]["checklist_total"] > 0
    assert item["badges"]["comments"] == 0  # comments were not kept
    assert body["board_version"] == version + 1
    assert checklist_ids_of(item["id"]) and checklist_ids_of(item["id"]) != checklist_ids_of(
        rich_card["id"]
    )


def test_the_copy_route_defaults_every_keep_flag_to_false(
    logged_in: LoggedIn, rich_card: dict[str, Any], lists: list[int]
) -> None:
    api, _user = logged_in

    response = api.post(
        f"/api/cards/{rich_card['id']}/copy",
        json={"title": "Bare copy", "to_list_id": lists[0]},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 201, response.text
    item = response.json()["item"]
    assert item["label_ids"] == []
    assert item["member_ids"] == []
    assert item["badges"] == {
        "description": True,  # the card's own columns always travel
        "comments": 0,
        "attachments": 0,
        "checklist_done": 0,
        "checklist_total": 0,
    }


def test_the_copy_route_refuses_a_destination_board_the_caller_cannot_write_to(
    logged_in: LoggedIn, lists: list[int], stranger: tuple[TestClient, dict[str, Any]]
) -> None:
    api, _user = logged_in
    _outsider, theirs = stranger
    source = create_card(api, lists[0], "Not going anywhere")["item"]

    response = api.post(
        f"/api/cards/{source['id']}/copy",
        json={"title": "Nope", "to_list_id": list_ids(theirs["id"])[0]},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"
    assert version_of(theirs["id"]) == 1


def test_the_move_route_carries_a_card_across_boards(
    logged_in: LoggedIn, board: dict[str, Any], lists: list[int], other_board: dict[str, Any]
) -> None:
    api, _user = logged_in
    card = create_card(api, lists[0], "Going to Ops", label_ids=label_ids(api, board["id"])[:1])[
        "item"
    ]
    target_list = list_ids(other_board["id"])[0]
    source_version, target_version = version_of(board["id"]), version_of(other_board["id"])

    response = api.post(
        f"/api/cards/{card['id']}/move",
        json={"to_list_id": target_list, "to_board_id": other_board["id"], "index": 0},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["item"]["board_id"] == other_board["id"]
    assert body["item"]["list_id"] == target_list
    assert body["item"]["label_ids"] == []  # labels are per board
    assert body["board_version"] == target_version + 1  # the *destination* board's version
    assert version_of(board["id"]) == source_version + 1  # bumped by the same COMMIT
    assert types_of(other_board["id"])[-1] == "card.moved_in"
    assert types_of(board["id"])[-1] == "card.moved_out"


def test_the_move_route_refuses_a_board_the_caller_is_not_a_member_of(
    logged_in: LoggedIn, lists: list[int], stranger: tuple[TestClient, dict[str, Any]]
) -> None:
    api, _user = logged_in
    _outsider, theirs = stranger
    card = create_card(api, lists[0], "Staying put")["item"]

    response = api.post(
        f"/api/cards/{card['id']}/move",
        json={
            "to_list_id": list_ids(theirs["id"])[0],
            "to_board_id": theirs["id"],
            "index": 0,
        },
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 403
    assert card_of(card["id"]).board_id != theirs["id"]
    assert version_of(theirs["id"]) == 1


def test_the_list_move_route_carries_a_column_and_its_cards_across_boards(
    logged_in: LoggedIn, board: dict[str, Any], lists: list[int], other_board: dict[str, Any]
) -> None:
    api, _user = logged_in
    card = create_card(api, lists[0], "Travelling with the column")["item"]
    target_version = version_of(other_board["id"])

    response = api.post(
        f"/api/lists/{lists[0]}/move",
        json={"to_board_id": other_board["id"], "index": 0},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["item"]["board_id"] == other_board["id"]
    assert body["board_version"] == target_version + 1
    assert card_of(card["id"]).board_id == other_board["id"]
    assert types_of(other_board["id"])[-1] == "list.moved_in"
    assert types_of(board["id"])[-1] == "list.moved_out"


def test_the_card_detail_lists_its_attachments_newest_first(
    logged_in: LoggedIn, lists: list[int]
) -> None:
    api, _user = logged_in
    card = create_card(api, lists[0], "With two files")["item"]
    first = add_upload_attachment(api, card["id"], "one.png")
    second = add_upload_attachment(api, card["id"], "two.png")
    set_attachment_cover(api, card["id"], second)

    attachments = detail(api, card["id"])["attachments"]

    assert [row["id"] for row in attachments] == [second, first]
    assert [row["is_cover"] for row in attachments] == [True, False]
    assert attachments[0]["url"] == f"/uploads/attachments/{second}/two.png"
    assert attachments[0]["thumb_url"] == f"/uploads/attachments/{second}/thumb.jpg"
    assert attachments[1]["kind"] == "upload"
