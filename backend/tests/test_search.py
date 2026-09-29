"""`GET /api/search`: the FTS5 popover query (Sections 2.1.1, 3.4, 4.7 and 7.3).

Everything runs through the public API (CLAUDE.md section 6): the cards are created with the
composer, their descriptions are set with `PATCH /api/cards/{card_id}`, and the archived, closed and
deleted states come from the real endpoints - which is the point of the trigger tests, since only a
real UPDATE or DELETE on `cards` fires `cards_au` / `cards_ad`. The helpers borrowed from
`test_cards.py` (`create_card`, `list_ids`) are reused rather than restated.

Search is the one read that spans every board, and this module's database lives for the whole file,
so each test scopes its assertions with `?board_id=` - its own fixture board - and the one test
that must search the whole install (the empty query) uses words no other test writes.

`/api/search` is registered by `main.create_app()`, so this module uses the shared `api` fixture of
`conftest.py` like every other API test.
"""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.conftest import CSRF_HEADERS
from tests.test_cards import create_card, list_ids, session

BoardFactory = Callable[..., dict[str, Any]]


# --------------------------------------------------------------------------- fixtures


@pytest.fixture
def rocket(api: TestClient, board: dict[str, Any]) -> dict[str, Any]:
    """One card, "Launch the rocket", in the seeded `To Do` list of the fixture board."""
    return create_card(api, list_ids(board["id"])[0], "Launch the rocket")["item"]


# --------------------------------------------------------------------------- helpers


def search(api: TestClient, q: str | None = None, **params: Any) -> dict[str, Any]:
    """`GET /api/search`, asserting the 200 every documented state answers with."""
    query: dict[str, Any] = dict(params)
    if q is not None:
        query["q"] = q
    response = api.get("/api/search", params=query)
    assert response.status_code == 200, response.text
    return response.json()


def card_titles(api: TestClient, board_id: int, q: str) -> list[str]:
    """The titles of the hits inside one board, so other tests' cards cannot leak in."""
    return [card["title"] for card in search(api, q, board_id=board_id)["cards"]]


def board_names(results: dict[str, Any]) -> list[str]:
    return [board["name"] for board in results["boards"]]


def describe(api: TestClient, card_id: int, description: str) -> None:
    """Give a card a description, which `cards_au` copies into `cards_fts`."""
    response = api.patch(
        f"/api/cards/{card_id}", json={"description": description}, headers=CSRF_HEADERS
    )
    assert response.status_code == 200, response.text


def indexed_rowids(term: str) -> list[int]:
    """The `cards_fts` rowids matching one term, read straight from the index.

    The one place this module reads SQL rather than the API (as `test_labels.py` does for
    `activities`): Section 7.3 makes "the triggers stay in sync after an update and a delete" part
    of this slice's contract, and a stale index row is by construction invisible through an
    endpoint that joins `cards` to `cards_fts.rowid`.
    """
    for db in session():
        return list(
            db.execute(
                text("SELECT rowid FROM cards_fts WHERE cards_fts MATCH :q ORDER BY rowid"),
                {"q": f'"{term}"*'},
            ).scalars()
        )
    raise AssertionError("unreachable")  # pragma: no cover


def retitle(api: TestClient, card_id: int, title: str) -> None:
    response = api.patch(f"/api/cards/{card_id}", json={"title": title}, headers=CSRF_HEADERS)
    assert response.status_code == 200, response.text


# --------------------------------------------------------------------------- matching


def test_finds_a_card_by_a_word_in_its_title(
    api: TestClient, board: dict[str, Any], rocket: dict[str, Any]
) -> None:
    results = search(api, "rocket", board_id=board["id"])

    assert len(results["cards"]) == 1
    hit = results["cards"][0]
    assert hit == {
        "id": rocket["id"],
        "short_id": rocket["short_id"],
        "title": "Launch the rocket",
        "board_id": board["id"],
        "list_id": rocket["list_id"],
        "board_name": board["name"],
        "list_name": "To Do",
        "labels": [],
    }


def test_finds_a_card_by_a_word_in_its_description(
    api: TestClient, board: dict[str, Any], rocket: dict[str, Any]
) -> None:
    describe(api, rocket["id"], "Coordinate with the **telemetry** crew before liftoff.")

    assert card_titles(api, board["id"], "telemetry") == ["Launch the rocket"]


def test_a_bare_term_is_a_prefix_match(
    api: TestClient, board: dict[str, Any], rocket: dict[str, Any]
) -> None:
    assert card_titles(api, board["id"], "roc") == ["Launch the rocket"]


def test_several_terms_narrow_the_results(
    api: TestClient, board: dict[str, Any], rocket: dict[str, Any]
) -> None:
    create_card(api, rocket["list_id"], "Launch the website")
    board_id = board["id"]

    assert card_titles(api, board_id, "launch rocket") == ["Launch the rocket"]
    assert sorted(card_titles(api, board_id, "launch")) == [
        "Launch the rocket",
        "Launch the website",
    ]
    assert card_titles(api, board_id, "launch zeppelin") == []


def test_labels_travel_with_a_hit(
    api: TestClient, board: dict[str, Any], rocket: dict[str, Any]
) -> None:
    label = api.get(f"/api/boards/{board['id']}/labels").json()["items"][0]
    renamed = api.patch(
        f"/api/labels/{label['id']}", json={"name": "Blocked", "tone": "bold"}, headers=CSRF_HEADERS
    )
    assert renamed.status_code == 200, renamed.text
    tagged = api.put(f"/api/cards/{rocket['id']}/labels/{label['id']}", headers=CSRF_HEADERS)
    assert tagged.status_code == 200, tagged.text

    hits = search(api, "rocket", board_id=board["id"])["cards"]

    assert hits[0]["labels"] == [{"color": label["color"], "tone": "bold", "name": "Blocked"}]


def test_limit_caps_the_card_group(
    api: TestClient, board: dict[str, Any], rocket: dict[str, Any]
) -> None:
    create_card(api, rocket["list_id"], "Launch the website")

    results = search(api, "launch", board_id=board["id"], limit=1)

    assert len(results["cards"]) == 1


def test_a_matching_board_comes_back_as_a_board_summary(
    api: TestClient, board: dict[str, Any]
) -> None:
    results = search(api, "sprint", board_id=board["id"])

    assert len(results["boards"]) == 1
    hit = results["boards"][0]
    assert hit.keys() == board.keys()  # the `BoardSummary` of Section 4.3, not a narrower shape
    assert hit["id"] == board["id"]
    assert hit["name"] == board["name"]
    assert hit["is_starred"] is False
    assert hit["is_closed"] is False
    assert results["cards"] == []


# --------------------------------------------------------------------------- the trigger sync


def test_index_follows_a_title_update(
    api: TestClient, board: dict[str, Any], rocket: dict[str, Any]
) -> None:
    retitle(api, rocket["id"], "Launch the balloon")

    assert card_titles(api, board["id"], "balloon") == ["Launch the balloon"]
    assert card_titles(api, board["id"], "rocket") == []


def test_index_follows_a_description_update(
    api: TestClient, board: dict[str, Any], rocket: dict[str, Any]
) -> None:
    describe(api, rocket["id"], "Waiting on the telemetry crew.")
    describe(api, rocket["id"], "Waiting on the fuelling crew.")

    assert card_titles(api, board["id"], "fuelling") == ["Launch the rocket"]
    assert card_titles(api, board["id"], "telemetry") == []


def test_index_drops_a_deleted_card(
    api: TestClient, board: dict[str, Any], rocket: dict[str, Any]
) -> None:
    describe(api, rocket["id"], "One perigee pass.")
    assert indexed_rowids("perigee") == [rocket["id"]]
    # `DELETE /api/cards/{id}` is 409 unless the card is archived first (Section 4.5).
    archived = api.post(f"/api/cards/{rocket['id']}/archive", headers=CSRF_HEADERS)
    assert archived.status_code == 200, archived.text

    assert api.delete(f"/api/cards/{rocket['id']}", headers=CSRF_HEADERS).status_code == 204

    assert card_titles(api, board["id"], "rocket") == []
    assert card_titles(api, board["id"], "perigee") == []
    # The endpoint joins `cards`, so a leaked index row would be invisible through it while it
    # skewed `bm25` and could resurface under a reused rowid: `cards_ad` is checked at the index.
    assert indexed_rowids("perigee") == []


# --------------------------------------------------------------------------- what is searchable


def test_a_card_on_another_board_is_found_without_a_board_filter(
    api: TestClient, board_factory: BoardFactory
) -> None:
    """One install, one index: `board_id` narrows the search, nothing hides a board from it."""
    elsewhere = board_factory("Secret submarines")
    create_card(api, list_ids(elsewhere["id"])[0], "Launch the submarine")

    # "submarine" appears in no other test of this module, so the whole install is searched here.
    everywhere = search(api, "submarine")

    assert [card["title"] for card in everywhere["cards"]] == ["Launch the submarine"]
    assert board_names(everywhere) == ["Secret submarines"]


def test_an_archived_card_is_excluded(
    api: TestClient, board: dict[str, Any], rocket: dict[str, Any]
) -> None:
    archived = api.post(f"/api/cards/{rocket['id']}/archive", headers=CSRF_HEADERS)
    assert archived.status_code == 200, archived.text

    assert card_titles(api, board["id"], "rocket") == []

    restored = api.post(f"/api/cards/{rocket['id']}/unarchive", headers=CSRF_HEADERS)
    assert restored.status_code == 200, restored.text
    assert card_titles(api, board["id"], "rocket") == ["Launch the rocket"]


def test_a_card_in_an_archived_list_is_excluded(
    api: TestClient, board: dict[str, Any], rocket: dict[str, Any]
) -> None:
    archived = api.post(f"/api/lists/{rocket['list_id']}/archive", headers=CSRF_HEADERS)
    assert archived.status_code == 200, archived.text

    assert card_titles(api, board["id"], "rocket") == []


def test_a_closed_board_is_excluded_from_both_groups(
    api: TestClient, board: dict[str, Any], rocket: dict[str, Any]
) -> None:
    assert board_names(search(api, "sprint", board_id=board["id"])) == [board["name"]]

    closed = api.post(f"/api/boards/{board['id']}/close", headers=CSRF_HEADERS)
    assert closed.status_code == 200, closed.text

    assert card_titles(api, board["id"], "rocket") == []
    assert search(api, "sprint", board_id=board["id"])["boards"] == []


def test_board_id_narrows_both_groups_to_one_board(
    api: TestClient, board_factory: BoardFactory
) -> None:
    first = board_factory("Gliders")
    second = board_factory("Gliders II")
    create_card(api, list_ids(first["id"])[0], "Fold the wingtips")
    create_card(api, list_ids(second["id"])[0], "Fold the tailplane")

    assert card_titles(api, first["id"], "fold") == ["Fold the wingtips"]
    assert board_names(search(api, "gliders", board_id=second["id"])) == ["Gliders II"]
    assert sorted(card["title"] for card in search(api, "fold")["cards"]) == [
        "Fold the tailplane",
        "Fold the wingtips",
    ]


# --------------------------------------------------------------------------- the query itself


@pytest.mark.parametrize(
    "query",
    ['"rocket"', "rocket*", "^rocket", "-rocket", "(rocket", 'rocket"', "**rocket**", "ROCKET"],
)
def test_operator_characters_are_searched_as_text(
    api: TestClient, board: dict[str, Any], rocket: dict[str, Any], query: str
) -> None:
    assert card_titles(api, board["id"], query) == ["Launch the rocket"]


@pytest.mark.parametrize("query", ["rocket OR zeppelin", "NEAR(rocket zeppelin)", "rocket AND"])
def test_fts_keywords_are_terms_not_operators(
    api: TestClient, board: dict[str, Any], rocket: dict[str, Any], query: str
) -> None:
    # `OR`, `AND` and `NEAR` are indexed words here, so each of these AND's a word the card has
    # not got: no error, and deliberately no hit - a stray keyword never widens somebody's search.
    assert card_titles(api, board["id"], query) == []


def test_a_query_of_operators_alone_matches_nothing(
    api: TestClient, rocket: dict[str, Any]
) -> None:
    assert search(api, '*^:-()" ') == {"boards": [], "cards": []}


def test_a_very_long_query_is_capped_rather_than_refused(
    api: TestClient, board: dict[str, Any], rocket: dict[str, Any]
) -> None:
    # 30 terms inside the documented 200-character `q`: only the first `MAX_TERMS` are searched,
    # so the hit survives and no request pays for one prefix scan per word of a pasted paragraph.
    pasted = " ".join(["launch", "the", "rocket"] * 10)
    assert len(pasted) <= 200

    assert card_titles(api, board["id"], pasted) == ["Launch the rocket"]


def test_an_empty_query_returns_empty_results(api: TestClient, rocket: dict[str, Any]) -> None:
    assert search(api, "") == {"boards": [], "cards": []}
    assert search(api, "   ") == {"boards": [], "cards": []}
    assert search(api) == {"boards": [], "cards": []}


def test_too_long_a_query_is_rejected(api: TestClient) -> None:
    response = api.get("/api/search", params={"q": "r" * 201})

    assert response.status_code == 422
