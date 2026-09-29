"""The activity feed of Sections 4.2 and 2.3.4: the read side of the activity log.

One endpoint answers both readers - the board drawer's feed and the card modal's - because they
are one query over one table: `GET /api/boards/{board_id}/activity`, narrowed by `card_id` for
the card. There is no second shape to declare for the card, so `ActivityOut` is the only row
model in the API and `lib/activity.ts` renders every sentence of the Section 3.8 table from
`type` + `data` alone.
"""

from typing import Any

from pydantic import BaseModel


class ActivityOut(BaseModel):
    """One `activities` row as either feed carries it (Section 4.2).

    `data` is the stored JSON object parsed back out, with the names denormalised at write time,
    so the sentence of the Section 3.8 table is rendered from `type` + `data` alone, no sentence
    is ever assembled on the server, and a row about a card that has since been deleted still
    carries the `card_title` captured when it was written.
    """

    id: int
    board_id: int
    card_id: int | None
    list_id: int | None
    type: str
    data: dict[str, Any]
    board_version: int
    created_at: str


#: The name Section 4.2 gives the row model of the feed. It is `ActivityOut` itself rather
#: than a second declaration, so there is one OpenAPI schema and one generated TypeScript type.
BoardActivityOut = ActivityOut


class ActivityPage(BaseModel):
    """One cursor page of the activity feed (Sections 4.2 and 4.1).

    Newest first (`ORDER BY id DESC`). `next_before` is the `activities.id` to page before, which
    is the last row's id when the page came back full and `null` once the end is reached - what
    tells the feed's infinite scroll to stop asking.
    """

    items: list[ActivityOut]
    next_before: int | None = None
