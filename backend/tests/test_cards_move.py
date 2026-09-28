"""`POST /api/cards/{card_id}/move` - the move contract of Sections 4.9, 3.6 and 6.7.2.

The highest-risk endpoint in the project, so this module asserts the contract itself rather than
one example of it: `index in == index out` over randomised moves, neighbour precedence and the
neighbour invariant, archived rows keeping their slot, the `MoveResult` `positions` map after a
renormalisation, strictly increasing positions after a thousand mixed operations, and two
interleaved movers serialised by `BEGIN IMMEDIATE` never producing a duplicate position.

The read helpers are the ones `test_cards.py` documents: the board payload and the lists router
are sibling M2 slices, so the stored rows are read with SQL.
"""

import random
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest
from fastapi.testclient import TestClient

from kanban import ratelimit
from kanban.models import User
from kanban.ordering import MIN_GAP, STEP
from tests.conftest import CSRF_HEADERS
from tests.test_cards import (
    active_cards,
    archive_list,
    card_row,
    create_card,
    list_ids,
    register,
)

BoardFactory = Callable[..., dict[str, Any]]
LoggedIn = tuple[TestClient, User]

#: `RateLimiter` allows 600 requests a minute per IP by design (Section 4.1); the property runs
#: below send more than that, so they refill the bucket exactly as the conftest fixture does.
REFILL_EVERY = 250


def move(api: TestClient, card_id: int, to_list_id: int, index: int, **body: Any) -> Any:
    """`POST /api/cards/{card_id}/move` with the single move body of Section 4.9."""
    return api.post(
        f"/api/cards/{card_id}/move",
        json={"to_list_id": to_list_id, "index": index, **body},
        headers=CSRF_HEADERS,
    )


def moved(api: TestClient, card_id: int, to_list_id: int, index: int, **body: Any) -> Any:
    """The same call, asserting the documented 200 and returning the `MoveResult`."""
    response = move(api, card_id, to_list_id, index, **body)
    assert response.status_code == 200, response.text
    return response.json()


def order_of(list_id: int) -> list[int]:
    """The list's active card ids in `(position, id)` order, asserting the ordering invariant.

    Active positions must be unique and strictly increasing. Archived rows are deliberately not
    checked: `index` is a slot over active siblings only, so a new card may legitimately take the
    position an archived row still holds (Section 3.6).
    """
    rows = active_cards(list_id)
    positions = [position for _, position in rows]
    assert positions == sorted(positions), f"positions out of order in list {list_id}: {positions}"
    assert len(set(positions)) == len(positions), f"duplicate positions in list {list_id}"
    return [card_id for card_id, _ in rows]


@pytest.fixture
def lists(board: dict[str, Any]) -> list[int]:
    """The seeded `To Do` / `Doing` / `Done` list ids of the module's board."""
    return list_ids(board["id"])


def seed_cards(api: TestClient, list_id: int, count: int) -> list[int]:
    """`count` cards appended to `list_id` through the composer, top to bottom."""
    return [create_card(api, list_id, f"Card {n}")["item"]["id"] for n in range(count)]


# --------------------------------------------------------------------------- the index contract


def test_index_in_equals_index_out_over_200_random_same_list_moves(
    logged_in: LoggedIn, lists: list[int]
) -> None:
    api, _user = logged_in
    todo = lists[0]
    cards = seed_cards(api, todo, 6)
    rng = random.Random(20260926)

    for attempt in range(200):
        card_id = rng.choice(cards)
        # A slot over the active siblings *with the moved card removed*, which is what
        # `@hello-pangea/dnd` reports as `destination.index` (Section 5.5).
        index = rng.randrange(len(cards))
        result = moved(api, card_id, todo, index)

        order = order_of(todo)
        assert order.index(card_id) == index, f"attempt {attempt}: {order}"
        assert result["item"]["position"] == dict(active_cards(todo))[card_id]
        assert sorted(order) == sorted(cards)


def test_an_index_past_the_end_is_clamped_to_an_append(
    logged_in: LoggedIn, lists: list[int]
) -> None:
    api, _user = logged_in
    todo = lists[0]
    cards = seed_cards(api, todo, 3)

    result = moved(api, cards[0], todo, 99)

    assert order_of(todo) == [cards[1], cards[2], cards[0]]
    assert result["item"]["position"] == 4 * STEP


def test_a_negative_index_is_422(logged_in: LoggedIn, lists: list[int]) -> None:
    api, _user = logged_in
    card_id = seed_cards(api, lists[0], 1)[0]

    response = move(api, card_id, lists[0], -1)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_a_body_without_an_index_is_422(logged_in: LoggedIn, lists: list[int]) -> None:
    api, _user = logged_in
    card_id = seed_cards(api, lists[0], 1)[0]

    response = api.post(
        f"/api/cards/{card_id}/move", json={"to_list_id": lists[0]}, headers=CSRF_HEADERS
    )

    assert response.status_code == 422


def test_patch_is_an_alias_of_post(logged_in: LoggedIn, lists: list[int]) -> None:
    api, _user = logged_in
    cards = seed_cards(api, lists[0], 2)

    response = api.patch(
        f"/api/cards/{cards[1]}/move",
        json={"to_list_id": lists[0], "index": 0},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 200, response.text
    assert order_of(lists[0]) == [cards[1], cards[0]]


# --------------------------------------------------------------------------- across lists


def test_a_cross_list_move_relocates_the_card_and_leaves_the_source_ordered(
    logged_in: LoggedIn, board: dict[str, Any], lists: list[int]
) -> None:
    api, _user = logged_in
    todo, doing = lists[0], lists[1]
    a, b, c = seed_cards(api, todo, 3)
    x = seed_cards(api, doing, 1)[0]

    result = moved(api, b, doing, 0, prev_id=None, next_id=x)

    assert result["item"]["list_id"] == doing
    assert result["item"]["position"] == STEP / 2
    assert (
        result["board_version"] == api.get(f"/api/boards/{board['id']}").json()["board"]["version"]
    )
    assert order_of(todo) == [a, c]
    assert order_of(doing) == [b, x]


def test_a_target_list_on_another_board_is_400(
    logged_in: LoggedIn, board_factory: BoardFactory, lists: list[int]
) -> None:
    api, _user = logged_in
    card_id = seed_cards(api, lists[0], 1)[0]
    foreign_list = list_ids(board_factory("Another board")["id"])[0]

    response = move(api, card_id, foreign_list, 0)

    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "bad_request"
    assert error["details"]["list_id"] == foreign_list
    stored = card_row(card_id)
    assert stored is not None
    assert stored.list_id == lists[0]


def test_a_target_list_that_does_not_exist_is_400(logged_in: LoggedIn, lists: list[int]) -> None:
    api, _user = logged_in
    card_id = seed_cards(api, lists[0], 1)[0]

    response = move(api, card_id, 999999, 0)

    assert response.status_code == 400


def test_an_archived_target_list_is_400(logged_in: LoggedIn, lists: list[int]) -> None:
    api, _user = logged_in
    card_id = seed_cards(api, lists[0], 1)[0]
    archive_list(lists[1])

    response = move(api, card_id, lists[1], 0)

    assert response.status_code == 400
    assert response.json()["error"]["details"] == {"list_id": lists[1]}


def test_moving_a_card_the_caller_cannot_see_is_404(logged_in: LoggedIn, lists: list[int]) -> None:
    api, _user = logged_in
    card_id = seed_cards(api, lists[0], 1)[0]
    stranger, _account = register(api, "outsider_move")

    assert move(stranger, card_id, lists[0], 0).status_code == 404


# --------------------------------------------------------------------------- neighbours


def test_neighbours_take_precedence_over_the_index(logged_in: LoggedIn, lists: list[int]) -> None:
    api, _user = logged_in
    todo = lists[0]
    a, b, c = seed_cards(api, todo, 3)

    # `index` says append, the neighbours say "between A and B": the neighbours win.
    moved(api, c, todo, 2, prev_id=a, next_id=b)

    assert order_of(todo) == [a, c, b]


def test_a_stale_neighbour_falls_back_to_the_other_side(
    logged_in: LoggedIn, lists: list[int]
) -> None:
    api, _user = logged_in
    todo = lists[0]
    a, b, c = seed_cards(api, todo, 3)

    # `prev_id` no longer exists, so only `next_id` is used - and `index` is still ignored.
    result = moved(api, b, todo, 2, prev_id=999999, next_id=a)

    assert result["item"]["position"] == STEP / 2
    assert order_of(todo) == [b, a, c]


def test_both_neighbours_stale_falls_back_to_an_append(
    logged_in: LoggedIn, lists: list[int]
) -> None:
    api, _user = logged_in
    todo = lists[0]
    a, b, c = seed_cards(api, todo, 3)

    # Both ids are gone, so the index form is used with index = len(active): an append, never
    # `between(None, None)`, which could collide with the first row after a renumber.
    result = moved(api, a, todo, 0, prev_id=999998, next_id=999999)

    assert result["item"]["position"] == 4 * STEP
    assert order_of(todo) == [b, c, a]


@pytest.mark.parametrize("side", ["prev_id", "next_id"])
def test_the_moved_card_may_never_be_its_own_neighbour(
    logged_in: LoggedIn, lists: list[int], side: str
) -> None:
    api, _user = logged_in
    a, b = seed_cards(api, lists[0], 2)

    response = move(api, a, lists[0], 1, **{side: a})

    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "bad_request"
    assert error["details"] == {"card_id": a}
    assert order_of(lists[0]) == [a, b]


def test_a_neighbour_from_another_list_is_400(logged_in: LoggedIn, lists: list[int]) -> None:
    api, _user = logged_in
    todo, doing = lists[0], lists[1]
    a, b = seed_cards(api, todo, 2)
    elsewhere = seed_cards(api, doing, 1)[0]

    response = move(api, a, todo, 1, prev_id=elsewhere)

    assert response.status_code == 400
    assert response.json()["error"]["details"]["card_ids"] == [elsewhere]
    assert order_of(todo) == [a, b]


# --------------------------------------------------------------------------- archived rows


def test_an_archived_card_keeps_its_slot_and_still_counts_as_a_neighbour(
    logged_in: LoggedIn, lists: list[int]
) -> None:
    api, _user = logged_in
    todo = lists[0]
    a, b, c = seed_cards(api, todo, 3)
    archived = api.post(f"/api/cards/{b}/archive", headers=CSRF_HEADERS).json()["item"]

    # Neighbours are matched over ALL siblings, archived rows included, so a stale client view
    # still lands next to the right row (Section 3.6).
    result = moved(api, c, todo, 0, prev_id=b)

    assert result["item"]["position"] == archived["position"] + STEP
    assert order_of(todo) == [a, c]
    stored = card_row(b)
    assert stored is not None
    assert stored.position == archived["position"]
    # And the slot is still there when the card comes back.
    api.post(f"/api/cards/{b}/unarchive", headers=CSRF_HEADERS)
    assert order_of(todo) == [a, b, c]


# --------------------------------------------------------------------------- renormalisation


def test_the_move_result_carries_the_authoritative_position_and_the_renumbered_map(
    logged_in: LoggedIn, lists: list[int]
) -> None:
    api, _user = logged_in
    todo = lists[0]
    a, b, x = seed_cards(api, todo, 3)

    # Swapping the two rows above A halves the gap between A and its successor every time, so
    # after about thirty moves the gap drops below MIN_GAP and the server renumbers the list.
    renumbered: dict[str, float] = {}
    for _ in range(100):
        moved(api, x, todo, 1)
        result = moved(api, b, todo, 1)
        if result["positions"]:
            renumbered = result["positions"]
            break
    else:  # pragma: no cover - a renumber must happen well inside 100 rounds
        raise AssertionError("the list never renormalised")

    assert renumbered == {str(a): STEP, str(x): 2 * STEP}
    assert result["item"]["position"] == 1.5 * STEP  # the moved row, between the renumbered pair
    assert str(b) not in renumbered  # the moved row is never in the map
    assert order_of(todo) == [a, b, x]
    positions = [position for _, position in active_cards(todo)]
    gaps = [after - before for before, after in zip(positions, positions[1:], strict=False)]
    assert all(gap >= MIN_GAP for gap in gaps), gaps


def test_an_ordinary_move_returns_an_empty_positions_map(
    logged_in: LoggedIn, lists: list[int]
) -> None:
    api, _user = logged_in
    cards = seed_cards(api, lists[0], 2)

    assert moved(api, cards[0], lists[0], 1)["positions"] == {}


# --------------------------------------------------------------------------- property runs


def test_1000_mixed_operations_keep_every_list_strictly_ordered(
    logged_in: LoggedIn, lists: list[int]
) -> None:
    """Create / move / archive / unarchive at random: positions never collide or invert."""
    api, _user = logged_in
    rng = random.Random(4242)
    cards: dict[int, int] = {}  # card id -> list id
    archived: set[int] = set()
    for list_id in lists:
        for card_id in seed_cards(api, list_id, 3):
            cards[card_id] = list_id

    for operation in range(1000):
        if operation % REFILL_EVERY == 0:
            ratelimit.reset_all()
        roll = rng.random()
        active = [card_id for card_id in cards if card_id not in archived]
        if roll < 0.60 and active:
            card_id = rng.choice(active)
            to_list_id = rng.choice(lists)
            siblings = len([other for other in active if cards[other] == to_list_id])
            index = rng.randrange(siblings + 1)
            assert moved(api, card_id, to_list_id, index)["item"]["list_id"] == to_list_id
            cards[card_id] = to_list_id
        elif roll < 0.75 or not active:
            to_list_id = rng.choice(lists)
            item = create_card(api, to_list_id, f"Op {operation}", index=rng.choice([0, "bottom"]))[
                "item"
            ]
            cards[item["id"]] = to_list_id
        elif roll < 0.90:
            card_id = rng.choice(active)
            archive = api.post(f"/api/cards/{card_id}/archive", headers=CSRF_HEADERS)
            assert archive.status_code == 200, archive.text
            archived.add(card_id)
        elif archived:
            card_id = rng.choice(sorted(archived))
            restored = api.post(f"/api/cards/{card_id}/unarchive", headers=CSRF_HEADERS)
            assert restored.status_code == 200, restored.text
            archived.discard(card_id)
            cards[card_id] = restored.json()["item"]["list_id"]

    seen: list[int] = []
    for list_id in lists:
        order = order_of(list_id)
        assert order == [card_id for card_id in order if cards[card_id] == list_id]
        seen.extend(order)
    assert sorted(seen) == sorted(card_id for card_id in cards if card_id not in archived)


def test_two_interleaved_movers_never_produce_a_duplicate_position(
    logged_in: LoggedIn, board: dict[str, Any], lists: list[int]
) -> None:
    """`BEGIN IMMEDIATE` serialises the two writers, so both get distinct midpoints (3.6)."""
    api, _user = logged_in
    todo = lists[0]
    cards = seed_cards(api, todo, 6)
    second, account = register(api, "second_mover")
    invited = api.put(
        f"/api/boards/{board['id']}/members/{account['id']}",
        json={"role": "member"},
        headers=CSRF_HEADERS,
    )
    assert invited.status_code == 200, invited.text

    def run(client: TestClient, seed: int) -> list[int]:
        rng = random.Random(seed)
        return [
            move(client, rng.choice(cards), todo, rng.randrange(len(cards))).status_code
            for _ in range(25)
        ]

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(run, api, 11), pool.submit(run, second, 22)]
        codes = [code for future in futures for code in future.result()]

    # A writer that cannot take the lock within `busy_timeout` answers 503, never a bad position.
    assert set(codes) <= {200, 503}, codes
    # `order_of` is the assertion: unique, strictly increasing positions over the same six cards.
    assert sorted(order_of(todo)) == sorted(cards)


def test_one_card_may_not_be_both_neighbours_of_the_same_slot(
    logged_in: LoggedIn, lists: list[int]
) -> None:
    """`between(p, p)` is `p`: a duplicate position, and a zero gap renormalises forever."""
    api, _user = logged_in
    a, b, c = seed_cards(api, lists[0], 3)

    response = move(api, a, lists[0], 1, prev_id=b, next_id=b)

    assert response.status_code == 400
    assert response.json()["error"]["details"] == {"card_id": b}
    assert order_of(lists[0]) == [a, b, c]
