"""In-process publish/subscribe for board changes, and the activity -> event mapping (4.8, 6.7).

`bus` is created at module level so `db.py` can import it directly; this module imports nothing
from `db.py` or the routers (`replay()` receives its `Session` as an argument), so there is no
cycle. The lifespan binds the running event loop (`event_bus.loop = asyncio.get_running_loop()`),
because `publish()` is called from a worker thread at the end of `write_tx` and `asyncio.Queue`
is not thread-safe.

Three things live here, and only here (CLAUDE.md section 3):

* `BoardBus`, the fan-out every SSE subscriber attaches a queue to;
* `event_from_activity()`, the one activity-row -> `EventOut` mapping of Section 4.8, used
  identically by the live publish, the `/events?since=` replay and `/changes?since=`, so a live
  event and the replay of the same row can never disagree;
* the three `Session` listeners that queue those payloads at FLUSH, publish them after COMMIT and
  drop them on a rollback, which `db.py` installs once through `install_session_listeners()`.

The listeners are how Section 6.7.2 step 10 ("queue the event beside the activity row it
describes") is implemented without a line in any service: every mutation already writes its rows
through `activity.record()`, so a service cannot forget to publish, no second copy of the mapping
appears beside any of them, and an event is impossible for a row that rolled back.
This is the only publish path: `write_tx` has no event queue of its own, so there is exactly one
place a committed write becomes an `EventOut` and the two cannot disagree.

`position` is filled for the three live move events of Section 4.8 from the row the move just
wrote, which is in the session's identity map by then, so the lookup costs no statement.
"""

import asyncio
import json
import logging
import threading
from dataclasses import dataclass
from typing import Any, Final

from sqlalchemy import event as sa_event
from sqlalchemy import select
from sqlalchemy.orm import Session

from kanban.models import Activity, Board, Card, List, utcnow_iso

logger = logging.getLogger(__name__)

#: One event payload, shaped like `EventOut` (Section 4.8).
Event = dict[str, Any]

#: How many undelivered events a single subscriber may lag behind before it is dropped; the
#: client's version gate turns a dropped event into one refetch, never into stale data.
QUEUE_MAXSIZE = 1000

#: How many missed rows `replay()` will send before it gives up and asks for a full refetch
#: instead (Section 4.8); beyond this the caller receives `resync` and no events.
MAX_REPLAY: Final[int] = 500

#: The two synthetic types of Section 4.8, which describe the stream rather than a write.
HELLO: Final[str] = "hello"
RESYNC: Final[str] = "resync"

#: `activities.type` prefix -> `EventOut.entity`. Every type's entity is its prefix.
ENTITY_BY_PREFIX: Final[dict[str, str]] = {
    "board": "board",
    "list": "list",
    "card": "card",
    "label": "label",
    "item": "item",
}

#: For the entities whose id is not a column of `activities`, the `data` key that carries it
#: (Section 4.8). `card`, `list` and `board` read their own column instead.
ID_DATA_KEY: Final[dict[str, str]] = {
    "label": "label_id",
    "item": "item_id",
}

#: The three live events that carry the moved row's new `position` (Section 4.8): the model to
#: read it from and the `activities` column naming the row.
_POSITIONED: Final[dict[str, tuple[type[Card] | type[List], str]]] = {
    "card.moved": (Card, "card_id"),
    "card.reordered": (Card, "card_id"),
    "list.moved": (List, "list_id"),
}

#: Where the payloads of one transaction wait between its FLUSH and its COMMIT, on `Session.info`.
_PENDING_KEY: Final[str] = "kanban_pending_events"


class BoardBus:
    """Fan-out of committed board writes to the SSE subscribers of that board."""

    def __init__(self) -> None:
        self._subscribers: dict[int, set[asyncio.Queue[Event]]] = {}
        self._lock = threading.Lock()
        #: Set by the lifespan once the server loop exists; None under the CLI and in unit tests.
        self.loop: asyncio.AbstractEventLoop | None = None

    def subscribe(self, board_id: int) -> asyncio.Queue[Event]:
        """Attach a queue to one board and return it. Call `unsubscribe` when the stream ends."""
        queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
        with self._lock:
            self._subscribers.setdefault(board_id, set()).add(queue)
        return queue

    def unsubscribe(self, board_id: int, queue: asyncio.Queue[Event]) -> None:
        """Detach a queue; unknown queues are ignored so teardown is always safe."""
        with self._lock:
            queues = self._subscribers.get(board_id)
            if queues is None:
                return
            queues.discard(queue)
            if not queues:
                del self._subscribers[board_id]

    def publish(self, board_id: int, event: Event) -> None:
        """Hand one committed event to every subscriber of `board_id`.

        Called from `write_tx` after COMMIT, on a threadpool worker, so every queue is fed
        through `loop.call_soon_threadsafe`. With no loop bound (CLI, unit tests) it is a no-op.
        """
        loop = self.loop
        if loop is None:
            return
        with self._lock:
            queues = list(self._subscribers.get(board_id, ()))
        for queue in queues:
            loop.call_soon_threadsafe(self._offer, queue, event)

    @staticmethod
    def _offer(queue: asyncio.Queue[Event], event: Event) -> None:
        """Never block the event loop: a subscriber that cannot keep up loses the event."""
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            logger.warning("Dropping event for a subscriber whose queue is full")


#: The singleton every writer publishes to; the lifespan also exposes it as `app.state.bus`.
bus = BoardBus()


# ------------------------------------------------------------------ activity -> EventOut (4.8)


def entity_of(activity_type: str) -> str:
    """The `EventOut.entity` of an activity type: the prefix before its dot.

    A type whose prefix is not in `ENTITY_BY_PREFIX` is reported as a board-level change, which
    the client answers with one board refetch, so a type added to `ACTIVITY_TYPES` later can
    never break a live stream.
    """
    prefix, _, _rest = activity_type.partition(".")
    return ENTITY_BY_PREFIX.get(prefix, "board")


def event_from_activity(row: Activity, *, position: float | None = None) -> Event:
    """Map one `activities` row onto the `EventOut` payload of Section 4.8.

    `id` comes from `card_id`, `list_id`, `board_id` or the matching `data.*_id` key, by entity.
    It is `None` only for `card.deleted`, whose row carries no `card_id`; the client treats that
    as a board-level change. `position` is passed by the live publish for the three move events
    and is never set on a replay, so a replayed event is the same payload minus that one field.
    """
    entity = entity_of(row.type)
    if entity == "card":
        identifier = row.card_id
    elif entity == "list":
        identifier = row.list_id
    elif entity == "board":
        identifier = row.board_id
    else:
        data: dict[str, Any] = json.loads(row.data)
        identifier = data.get(ID_DATA_KEY[entity])
    return {
        "version": row.board_version,
        "type": row.type,
        "entity": entity,
        "id": identifier,
        "card_id": row.card_id,
        "list_id": row.list_id,
        "position": position,
        "at": row.created_at,
    }


def board_event(type: str, board_id: int, version: int) -> Event:
    """One of the two synthetic events (`hello`, `resync`) that describe the stream itself.

    They belong to no activity row, so `at` is the moment they are sent; `version` is the board's
    current version, which is what the client gates against.
    """
    return {
        "version": version,
        "type": type,
        "entity": "board",
        "id": board_id,
        "card_id": None,
        "list_id": None,
        "position": None,
        "at": utcnow_iso(),
    }


@dataclass(frozen=True)
class Replay:
    """What a client missed: the board's current version, the events after `since`, `resync`.

    `events` is empty when `resync` is true (more than `MAX_REPLAY` rows are pending): the client
    refetches the board instead of applying a backlog it would collapse into one refetch anyway.
    """

    version: int
    events: list[Event]
    resync: bool


def replay(db: Session, board_id: int, since_version: int) -> Replay:
    """The events of `board_id` with `board_version > since_version`, oldest first (Section 4.8).

    A plain synchronous SELECT: the SSE router awaits it through `run_in_threadpool` before it
    attaches its queue, and `/changes` calls it in its own threadpool-run handler. `board_id` has
    already been resolved by `board_access`, so the board exists; a `since_version` at or above
    the current version yields no events.
    """
    version = db.execute(select(Board.version).where(Board.id == board_id)).scalar_one()
    rows = (
        db.execute(
            select(Activity)
            .where(Activity.board_id == board_id, Activity.board_version > since_version)
            .order_by(Activity.board_version, Activity.id)
            .limit(MAX_REPLAY + 1)
        )
        .scalars()
        .all()
    )
    if len(rows) > MAX_REPLAY:
        return Replay(version=version, events=[], resync=True)
    return Replay(version=version, events=[event_from_activity(row) for row in rows], resync=False)


# ------------------------------------------------------- queue at FLUSH, publish after COMMIT


def _live_position(session: Session, row: Activity) -> float | None:
    """The new `position` of the row a move event describes, or `None` for any other type.

    The moved `Card` / `List` was written by the same flush, so it is in the session's identity
    map and `Session.get` returns it without a statement (`expire_on_commit=False`, `db.py`).
    """
    positioned = _POSITIONED.get(row.type)
    if positioned is None:
        return None
    model, column = positioned
    target_id: int | None = getattr(row, column)
    moved = session.get(model, target_id) if target_id is not None else None
    return None if moved is None else moved.position


def _queue_activity_events(session: Session, _flush_context: Any) -> None:
    """Turn the `activities` rows this flush inserted into queued event payloads.

    They have their ids by now (`after_flush` runs once the INSERTs are out, while `session.new`
    still lists them) and are mapped to plain dicts immediately, so nothing holds an ORM object
    past the commit that publishes them.
    """
    inserted = [row for row in session.new if isinstance(row, Activity)]
    if not inserted:
        return
    pending: list[tuple[int, Event]] = session.info.setdefault(_PENDING_KEY, [])
    pending.extend(
        (row.board_id, event_from_activity(row, position=_live_position(session, row)))
        for row in inserted
    )


def _publish_committed_events(session: Session) -> None:
    """Publish what the transaction queued, after COMMIT, so a subscriber can fetch the row."""
    for board_id, payload in session.info.pop(_PENDING_KEY, ()):
        bus.publish(board_id, payload)


def _drop_rolled_back_events(session: Session, _previous_transaction: Any) -> None:
    """A transaction that rolled back publishes nothing: its queue goes with it."""
    session.info.pop(_PENDING_KEY, None)


def install_session_listeners() -> None:
    """Attach the three listeners above to every `Session`. Called once, by `db.py`.

    Explicit rather than an import-time side effect: `db.py` owns `SessionLocal`, so it is the
    module that wires the publish half of a write, and a reader of it can see that a committed
    activity row becomes an event without having to know that importing `events` did it.
    """
    sa_event.listen(Session, "after_flush", _queue_activity_events)
    sa_event.listen(Session, "after_commit", _publish_committed_events)
    sa_event.listen(Session, "after_soft_rollback", _drop_rolled_back_events)
