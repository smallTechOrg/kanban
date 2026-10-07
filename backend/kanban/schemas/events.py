"""The realtime shapes: one SSE message and one page of the polling fallback (Sections 4.3, 4.8).

`EventOut` is the payload of every `event:` frame of `GET /api/boards/{board_id}/events` and of
every item of `GET /api/boards/{board_id}/changes`, because both are built from the same mapping
in `kanban/events.py`. Events are **notifications, not patches**: nothing here carries a title, a
body or a row, so a client can only answer an event by refetching what it names.
"""

from typing import Literal

from pydantic import BaseModel

from kanban.schemas.common import OptionalFieldsOmitted

#: The five entities an event can name (Section 4.8); `item` is a card item.
EventEntity = Literal["board", "list", "card", "label", "item"]


class EventOut(OptionalFieldsOmitted):
    """One board change, addressed by id and ordered by board version (Section 4.8).

    `type` is an activity type of Section 3.8 plus the two synthetic `hello` (the current version,
    sent on connect) and `resync` (more than 500 events were missed). `id` is `null` only for
    `card.deleted`, whose activity row carries no `card_id`, and which the client therefore treats
    as a board-level change. `card_id`, `list_id` and `position` are absent rather than `null`
    when the event has none: `position` is carried by the live `card.moved`, `card.reordered` and
    `list.moved` events only, and never by a replayed one.
    """

    optional_fields = ("card_id", "list_id", "position")

    version: int
    type: str
    entity: EventEntity
    id: int | None
    card_id: int | None = None
    list_id: int | None = None
    position: float | None = None
    at: str


class ChangesOut(BaseModel):
    """`GET /api/boards/{board_id}/changes?since=N`: the polling fallback of Section 4.3.

    `version` is the board's current version, so a client that has fallen behind the 500-event
    replay cap can still tell how far. `resync` is true exactly when that cap was exceeded, and
    `events` is then empty: the client refetches the board instead of applying the backlog.
    """

    version: int
    events: list[EventOut]
    resync: bool
