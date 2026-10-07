"""Realtime: the activity -> event mapping, the replay, the SSE stream and polling (4.8, 7.3).

Everything runs through the public interface (CLAUDE.md section 6): every event in these tests was
produced by a real mutation, read back through `GET /api/boards/{id}/changes` or
`GET /api/boards/{id}/events`, and the live publish is observed on `events.bus`, which is the one
seam a committed event is handed to.

The stream tests drive the app the way an HTTP server does, through `open_stream` below, because
neither `TestClient` nor `httpx.ASGITransport` can read a response that never ends: both run the
ASGI app to completion and only then hand back a buffered body. They read the frames the endpoint
sends before it blocks on its queue, with a timeout on every read, and then disconnect.
"""

import asyncio
import json
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from typing import Any

import pytest
from fastapi.testclient import TestClient

from kanban import events
from kanban.routers import events as events_router
from tests.conftest import CSRF_HEADERS
from tests.test_cards import create_card, list_ids

#: Every key an `EventOut` may carry (Section 4.8). An event names ids and a version and nothing
#: else: the test below asserts no title, name or body ever leaks into a payload.
EVENT_KEYS = {"version", "type", "entity", "id", "card_id", "list_id", "position", "at"}


# --------------------------------------------------------------------------- helpers


def changes(api: TestClient, board_id: int, since: int) -> dict[str, Any]:
    """`GET /api/boards/{board_id}/changes?since=`, asserting the documented 200."""
    response = api.get(f"/api/boards/{board_id}/changes", params={"since": since})
    assert response.status_code == 200, response.text
    return response.json()


def rename(api: TestClient, board_id: int, name: str) -> int:
    """Rename the board; returns the `board_version` the mutation reports (Section 4.1)."""
    response = api.patch(f"/api/boards/{board_id}", json={"name": name}, headers=CSRF_HEADERS)
    assert response.status_code == 200, response.text
    return int(response.json()["board_version"])


def create_list(api: TestClient, board_id: int, name: str) -> dict[str, Any]:
    """`POST /api/boards/{board_id}/lists`, returning the created `ListOut`."""
    response = api.post(f"/api/boards/{board_id}/lists", json={"name": name}, headers=CSRF_HEADERS)
    assert response.status_code == 201, response.text
    return dict(response.json()["item"])


#: How long a stream test waits for a frame it expects before it fails instead of hanging.
FRAME_TIMEOUT = 5.0


def parse_frame(raw: str) -> dict[str, Any]:
    """One SSE message as `{id, event, data}`, or `{comment}` for a `:` comment line."""
    frame: dict[str, Any] = {}
    for line in raw.split("\r\n"):
        if line.startswith(": "):
            frame["comment"] = line[2:]
        elif line.startswith("id: "):
            frame["id"] = line[4:]
        elif line.startswith("event: "):
            frame["event"] = line[7:]
        elif line.startswith("data: "):
            frame["data"] = json.loads(line[6:])
    return frame


class SseStream:
    """One open `text/event-stream` response, read message by message as the app sends them."""

    def __init__(self, incoming: asyncio.Queue[dict[str, Any]]) -> None:
        self._incoming = incoming
        self._buffer = ""
        self.status = 0
        self.headers: dict[str, str] = {}

    async def start(self) -> None:
        """Take the response head, so a test can assert on the status and the SSE headers."""
        message = await asyncio.wait_for(self._incoming.get(), FRAME_TIMEOUT)
        assert message["type"] == "http.response.start", message
        self.status = message["status"]
        self.headers = {key.decode(): value.decode() for key, value in message["headers"]}

    async def frames(self, count: int) -> list[dict[str, Any]]:
        """The next `count` messages, events and heartbeat comments alike, in order."""
        frames: list[dict[str, Any]] = []
        while len(frames) < count:
            while "\r\n\r\n" not in self._buffer:
                message = await asyncio.wait_for(self._incoming.get(), FRAME_TIMEOUT)
                assert message["type"] == "http.response.body", message
                self._buffer += message["body"].decode()
            raw, _, self._buffer = self._buffer.partition("\r\n\r\n")
            frames.append(parse_frame(raw))
        return frames


@asynccontextmanager
async def open_stream(
    api: TestClient, path: str, query: str = "", extra_headers: dict[str, str] | None = None
) -> AsyncIterator[SseStream]:
    """Open `path` as a server would and disconnect on the way out (see the module docstring).

    The ASGI `receive` channel answers `http.disconnect` once the block ends, which is what
    `EventSourceResponse` waits for to stop streaming.
    """
    headers = {"host": "testserver", **(extra_headers or {})}
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": query.encode(),
        "root_path": "",
        "headers": [(key.lower().encode(), value.encode()) for key, value in headers.items()],
        "client": ("127.0.0.1", 54321),
        "server": ("testserver", 80),
    }
    incoming: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    disconnected = asyncio.Event()
    body_sent = False

    async def receive() -> dict[str, Any]:
        nonlocal body_sent
        if not body_sent:
            body_sent = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await disconnected.wait()
        return {"type": "http.disconnect"}

    async def send(message: dict[str, Any]) -> None:
        await incoming.put(message)

    served = asyncio.create_task(api.app(scope, receive, send))
    stream = SseStream(incoming)
    try:
        await stream.start()
        yield stream
    finally:
        disconnected.set()
        await asyncio.wait_for(served, FRAME_TIMEOUT)


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> list[tuple[int, events.Event]]:
    """Every `(board_id, event)` the bus is handed while the test runs.

    `bus.publish` is the seam: it is what the `after_commit` listener of `events.py` calls once a
    write has committed, and it is a no-op in a test process with no event loop bound, so
    capturing the call is the only way to observe a live event without an SSE client attached.
    """
    captured: list[tuple[int, events.Event]] = []
    monkeypatch.setattr(
        events.bus, "publish", lambda board_id, event: captured.append((board_id, event))
    )
    return captured


@pytest.fixture
def quick_heartbeat(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Shorten the 20 s heartbeat so a test can watch two pings arrive."""
    monkeypatch.setattr(events_router, "HEARTBEAT_SECONDS", 0.05)
    yield


# --------------------------------------------------------------------------- the replay


def test_changes_returns_exactly_the_events_after_since(
    api: TestClient, board: dict[str, Any]
) -> None:
    renamed_at = rename(api, board["id"], "Sprint 43")
    create_list(api, board["id"], "Backlog")

    everything = changes(api, board["id"], 0)
    tail = changes(api, board["id"], renamed_at)

    assert [event["type"] for event in everything["events"]][0] == "board.created"
    assert [event["version"] for event in everything["events"]] == sorted(
        event["version"] for event in everything["events"]
    )
    assert tail["events"] == [e for e in everything["events"] if e["version"] > renamed_at]
    assert [event["type"] for event in tail["events"]] == ["list.created"]
    assert changes(api, board["id"], tail["version"])["events"] == []


def test_changes_reports_the_current_board_version(api: TestClient, board: dict[str, Any]) -> None:
    renamed_at = rename(api, board["id"], "Sprint 44")

    page = changes(api, board["id"], 0)

    assert page["version"] == renamed_at
    assert page["resync"] is False
    assert all(event["version"] <= renamed_at for event in page["events"])


def test_changes_needs_a_cursor(api: TestClient, board: dict[str, Any]) -> None:
    assert api.get(f"/api/boards/{board['id']}/changes").status_code == 422


def test_every_entity_and_id_comes_from_its_own_source(
    api: TestClient, board: dict[str, Any]
) -> None:
    since = board["version"]
    new_list = create_list(api, board["id"], "Backlog")
    card = create_card(api, new_list["id"], "Ship the realtime slice")["item"]
    label = api.post(
        f"/api/boards/{board['id']}/labels",
        json={"name": "Urgent", "color": "red"},
        headers=CSRF_HEADERS,
    ).json()["item"]
    item = api.post(
        f"/api/cards/{card['id']}/items", json={"name": "Draft"}, headers=CSRF_HEADERS
    ).json()["item"]

    by_type = {event["type"]: event for event in changes(api, board["id"], since)["events"]}

    assert (by_type["list.created"]["entity"], by_type["list.created"]["id"]) == (
        "list",
        new_list["id"],
    )
    assert (by_type["card.created"]["entity"], by_type["card.created"]["id"]) == (
        "card",
        card["id"],
    )
    assert by_type["card.created"]["list_id"] == new_list["id"]
    assert (by_type["label.created"]["entity"], by_type["label.created"]["id"]) == (
        "label",
        label["id"],
    )
    assert (by_type["item.added"]["entity"], by_type["item.added"]["id"]) == (
        "item",
        item["id"],
    )
    assert by_type["item.added"]["card_id"] == card["id"]
    assert all(set(event) <= EVENT_KEYS for event in by_type.values())


def test_a_board_event_names_the_board(api: TestClient, board: dict[str, Any]) -> None:
    rename(api, board["id"], "Sprint 45")

    renamed = changes(api, board["id"], 0)["events"][-1]

    assert renamed["type"] == "board.renamed"
    assert (renamed["entity"], renamed["id"]) == ("board", board["id"])
    # A notification, not a patch: neither the old nor the new name travels with it.
    assert set(renamed) == EVENT_KEYS - {"card_id", "list_id", "position"}


def test_a_deleted_card_has_no_id(api: TestClient, board: dict[str, Any]) -> None:
    since = board["version"]
    card = create_card(api, list_ids(board["id"])[0], "Throwaway")["item"]
    assert api.delete(f"/api/cards/{card['id']}", headers=CSRF_HEADERS).status_code == 204

    deleted = [
        event
        for event in changes(api, board["id"], since)["events"]
        if event["type"] == "card.deleted"
    ]

    assert len(deleted) == 1
    assert (deleted[0]["entity"], deleted[0]["id"]) == ("card", None)
    assert "card_id" not in deleted[0]


def test_more_than_the_cap_asks_for_a_resync(
    api: TestClient, board: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    since = board["version"]
    rename(api, board["id"], "Sprint 46")
    latest = rename(api, board["id"], "Sprint 47")
    monkeypatch.setattr(events, "MAX_REPLAY", 1)

    page = changes(api, board["id"], since)

    assert page["resync"] is True
    assert page["events"] == []
    assert page["version"] == latest


def test_neither_transport_serves_a_board_that_does_not_exist(api: TestClient) -> None:
    """Both routes hang off `board_access()`, which answers 404 before either starts (6.6)."""
    assert api.get("/api/boards/424242/changes", params={"since": 0}).status_code == 404
    assert api.get("/api/boards/424242/events").status_code == 404


# --------------------------------------------------------------------------- the live publish


def test_a_mutation_publishes_one_event_carrying_the_new_version(
    api: TestClient, board: dict[str, Any], published: list[tuple[int, events.Event]]
) -> None:
    version = rename(api, board["id"], "Sprint 48")

    assert len(published) == 1
    board_id, event = published[0]
    assert board_id == board["id"]
    assert event["version"] == version
    assert (event["type"], event["entity"], event["id"]) == ("board.renamed", "board", board["id"])
    assert set(event) == EVENT_KEYS


def test_a_live_move_carries_the_new_position(
    api: TestClient, board: dict[str, Any], published: list[tuple[int, events.Event]]
) -> None:
    todo, doing = list_ids(board["id"])[:2]
    card = create_card(api, todo, "Move me")["item"]
    published.clear()

    response = api.post(
        f"/api/cards/{card['id']}/move",
        json={"to_list_id": doing, "index": 0},
        headers=CSRF_HEADERS,
    )
    assert response.status_code == 200, response.text

    assert len(published) == 1
    _board_id, event = published[0]
    assert event["type"] == "card.moved"
    assert event["position"] == response.json()["item"]["position"]
    assert event["list_id"] == doing


def test_a_rolled_back_mutation_publishes_nothing(
    api: TestClient, board: dict[str, Any], published: list[tuple[int, events.Event]]
) -> None:
    create_card(api, list_ids(board["id"])[0], "Still on the board")
    published.clear()

    # 409 `conflict`: an open board cannot be deleted, and `write_tx` had already opened when
    # the service raised, so the rollback is what must leave the queue empty (Section 3.7).
    assert api.delete(f"/api/boards/{board['id']}", headers=CSRF_HEADERS).status_code == 409
    assert published == []


# --------------------------------------------------------------------------- the SSE stream


def test_the_stream_says_hello_replays_and_then_streams_live(
    api: TestClient, board: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    renamed_at = rename(api, board["id"], "Sprint 49")

    async def scenario() -> None:
        # The bus feeds its queues through this loop; in production the lifespan binds it.
        monkeypatch.setattr(events.bus, "loop", asyncio.get_running_loop())
        async with open_stream(
            api, f"/api/boards/{board['id']}/events", f"since={renamed_at - 1}"
        ) as stream:
            assert stream.status == 200
            assert stream.headers["content-type"].startswith("text/event-stream")
            assert stream.headers["cache-control"] == "no-cache"

            hello, replayed = await stream.frames(2)
            assert hello["event"] == "hello"
            assert (hello["id"], hello["data"]["version"]) == (str(renamed_at), renamed_at)
            assert (hello["data"]["entity"], hello["data"]["id"]) == ("board", board["id"])
            assert replayed["event"] == "board.renamed"
            assert (replayed["id"], replayed["data"]["version"]) == (str(renamed_at), renamed_at)
            # A replayed event never carries a position (Section 4.8).
            assert "position" not in replayed["data"]

            # The mutation runs on a worker thread, as it does under the server, so the publish
            # reaches this loop through `call_soon_threadsafe`.
            live_at = await asyncio.to_thread(rename, api, board["id"], "Sprint 50")
            (live,) = await stream.frames(1)
            assert live["event"] == "board.renamed"
            assert (live["id"], live["data"]["version"]) == (str(live_at), live_at)

    asyncio.run(scenario())


def test_the_stream_reads_its_cursor_from_last_event_id(
    api: TestClient, board: dict[str, Any]
) -> None:
    renamed_at = rename(api, board["id"], "Sprint 51")
    path = f"/api/boards/{board['id']}/events"

    async def scenario() -> None:
        async with open_stream(
            api, path, extra_headers={"last-event-id": str(renamed_at - 1)}
        ) as stream:
            _hello, replayed = await stream.frames(2)
            assert replayed["data"]["version"] == renamed_at

        # A header that is not a number is ignored rather than refused: the replay starts at zero.
        async with open_stream(api, path, extra_headers={"last-event-id": "nonsense"}) as stream:
            _hello, first = await stream.frames(2)
            assert first["event"] == "board.created"

    asyncio.run(scenario())


def test_the_stream_asks_for_a_resync_beyond_the_cap(
    api: TestClient, board: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    since = board["version"]
    rename(api, board["id"], "Sprint 52")
    latest = rename(api, board["id"], "Sprint 53")
    monkeypatch.setattr(events, "MAX_REPLAY", 1)

    async def scenario() -> None:
        async with open_stream(
            api, f"/api/boards/{board['id']}/events", f"since={since}"
        ) as stream:
            hello, resync = await stream.frames(2)
            assert hello["event"] == "hello"
            assert resync["event"] == "resync"
            assert (resync["id"], resync["data"]["version"]) == (str(latest), latest)
            assert (resync["data"]["entity"], resync["data"]["id"]) == ("board", board["id"])

    asyncio.run(scenario())


def test_the_heartbeat_is_a_comment_not_an_event(
    api: TestClient, board: dict[str, Any], quick_heartbeat: None
) -> None:
    async def scenario() -> None:
        async with open_stream(
            api, f"/api/boards/{board['id']}/events", f"since={board['version']}"
        ) as stream:
            hello, first_ping, second_ping = await stream.frames(3)
            assert hello["event"] == "hello"
            assert [first_ping, second_ping] == [{"comment": "ping"}, {"comment": "ping"}]

    asyncio.run(scenario())


def test_the_stream_and_the_polling_fallback_agree(api: TestClient, board: dict[str, Any]) -> None:
    since = board["version"]
    create_list(api, board["id"], "Backlog")
    rename(api, board["id"], "Sprint 54")
    polled = changes(api, board["id"], since)

    async def scenario() -> None:
        async with open_stream(
            api, f"/api/boards/{board['id']}/events", f"since={since}"
        ) as stream:
            frames = await stream.frames(1 + len(polled["events"]))
            assert frames[0]["event"] == "hello"
            assert [frame["data"] for frame in frames[1:]] == polled["events"]

    asyncio.run(scenario())


# --------------------------------------------------------------------------- the bus itself


def test_the_bus_tolerates_a_missing_loop_and_a_repeated_unsubscribe() -> None:
    """Publishing under the CLI (no loop bound) is a no-op, and teardown is always safe."""
    bus = events.BoardBus()

    bus.publish(7, {"version": 1})  # nothing is subscribed and no loop exists: not an error

    queue = bus.subscribe(7)
    bus.unsubscribe(7, queue)
    bus.unsubscribe(7, queue)  # the board left the registry with its last queue
    bus.unsubscribe(99, queue)  # a board that was never watched


def test_a_subscriber_that_cannot_keep_up_loses_the_event() -> None:
    """A full queue must never block the loop: the version gate turns a loss into one refetch."""

    async def scenario() -> None:
        bus = events.BoardBus()
        bus.loop = asyncio.get_running_loop()
        queue = bus.subscribe(3)
        for filler in range(events.QUEUE_MAXSIZE):
            queue.put_nowait({"version": filler})

        bus.publish(3, {"version": events.QUEUE_MAXSIZE})
        await asyncio.sleep(0.01)  # let the `call_soon_threadsafe` callback run

        assert queue.qsize() == events.QUEUE_MAXSIZE

    asyncio.run(scenario())
