"""Realtime: the SSE stream and its polling fallback (Sections 4.3 and 4.8).

Thin by contract (Section 6.4): both handlers resolve `board_access` - membership, so a stranger
gets 404 and board ids cannot be enumerated - then call `events.replay()` for what the caller
missed and wrap the result. The mapping from an `activities` row to an event payload is
`kanban/events.py`'s alone, so the replay and the live stream can never disagree.

`GET /boards/{board_id}/events` is `async def` because it returns a stream that outlives the
handler; the replay SELECT is a synchronous SQLAlchemy query, so it is awaited through
`run_in_threadpool` **before** the queue is attached (Section 4.8) and the request's read snapshot
is released in the same worker: a stream can last hours and must hold neither a WAL snapshot nor
one of the engine's pooled connections while it does. Any event published between the replay and
the attach is covered by the client's version gate, which is what Section 4.8 relies on.
"""

from collections.abc import AsyncIterator
from typing import Annotated, Final

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session
from sse_starlette.event import ServerSentEvent
from sse_starlette.sse import EventSourceResponse
from starlette.concurrency import run_in_threadpool

from kanban import events
from kanban.auth import BoardCtx, Role, board_access
from kanban.db import get_db
from kanban.schemas.events import ChangesOut, EventOut

router = APIRouter(tags=["events"])

Db = Annotated[Session, Depends(get_db)]
#: Realtime is a read: every member may watch a board, observers included, open or closed.
ReadAccess = Annotated[BoardCtx, Depends(board_access(Role.observer))]

#: Seconds between the `: ping` comments that keep proxies from closing an idle stream (4.8).
HEARTBEAT_SECONDS: Final[int] = 20

#: The header `EventSource` sends on its own when it reconnects; `?since=` wins when both arrive.
LAST_EVENT_ID: Final[str] = "last-event-id"


@router.get("/boards/{board_id}/events", response_class=EventSourceResponse)
async def stream_board_events(
    request: Request,
    ctx: ReadAccess,
    db: Db,
    since: Annotated[
        int | None, Query(ge=0, description="The client's cached board version")
    ] = None,
) -> EventSourceResponse:
    """Stream this board's changes: `hello`, then what was missed, then live events (4.8)."""
    missed = await run_in_threadpool(_missed, db, ctx.board_id, _since(request, since))
    return EventSourceResponse(
        _live(ctx.board_id, missed),
        ping=HEARTBEAT_SECONDS,
        ping_message_factory=_ping,
        # Section 4.8 asks for `no-cache`; sse-starlette would otherwise default to `no-store`.
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/boards/{board_id}/changes", response_model=ChangesOut)
def board_changes(
    ctx: ReadAccess,
    db: Db,
    since: Annotated[int, Query(ge=0, description="The client's cached board version")],
) -> ChangesOut:
    """The same events as the stream, for the polling fallback of Sections 2.10 and 4.8."""
    missed = events.replay(db, ctx.board_id, since)
    return ChangesOut(
        version=missed.version,
        events=[EventOut.model_validate(payload) for payload in missed.events],
        resync=missed.resync,
    )


def _since(request: Request, since: int | None) -> int:
    """The version to replay from: the query parameter, else `Last-Event-ID`, else 0.

    `EventSource` resends the id of the last message it saw when it reconnects, and every message
    carries the board version as its id, so the header alone is a complete cursor. A header that
    is not a number is ignored rather than refused: it can only be a proxy's invention.
    """
    if since is not None:
        return since
    header = request.headers.get(LAST_EVENT_ID, "")
    return int(header) if header.isdigit() else 0


def _missed(db: Session, board_id: int, since_version: int) -> events.Replay:
    """Run the replay query and release the request's read snapshot before the stream starts."""
    try:
        return events.replay(db, board_id, since_version)
    finally:
        # The handler is about to return a response that lives far longer than the request, and
        # `get_db`'s own rollback only runs when the stream ends. Ending the snapshot here hands
        # the pooled connection back so N open streams do not exhaust the pool.
        db.rollback()


async def _live(board_id: int, missed: events.Replay) -> AsyncIterator[ServerSentEvent]:
    """`hello`, the missed events (or one `resync`), then every event published from now on.

    The queue is attached first, before the first frame is yielded, so nothing published while the
    replay is being written out is lost. The generator only ever ends by cancellation - a client
    disconnect or server shutdown, both of which `EventSourceResponse` turns into one - so the
    queue is detached in a `finally`.
    """
    queue = events.bus.subscribe(board_id)
    try:
        yield _frame(events.board_event(events.HELLO, board_id, missed.version))
        if missed.resync:
            yield _frame(events.board_event(events.RESYNC, board_id, missed.version))
        for payload in missed.events:
            yield _frame(payload)
        while True:
            yield _frame(await queue.get())
    finally:
        events.bus.unsubscribe(board_id, queue)


def _frame(payload: events.Event) -> ServerSentEvent:
    """One SSE message: `id` is the board version, `event` the type, `data` the `EventOut` JSON."""
    return ServerSentEvent(
        id=str(payload["version"]),
        event=payload["type"],
        data=EventOut.model_validate(payload).model_dump_json(),
    )


def _ping() -> ServerSentEvent:
    """The heartbeat of Section 4.8: the comment `: ping`, which is not an event."""
    return ServerSentEvent(comment="ping")
