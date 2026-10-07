"""The activity feed (Sections 4.2, 2.3.4 and 3.8): the read side of the activity log.

`kanban/activity.py` `record()` is the only writer of an `activities` row and the only place the
Section 3.8 vocabulary lives (CLAUDE.md section 3); this module adds no type, no sentence and no
`data` key of its own. It answers one question - "what happened on this board, newest first" -
and hands the rows back exactly as they were stored, with `data` parsed from its JSON text, so
`lib/activity.ts` renders every sentence from `type` + `data` and a row about a card that has
since been deleted still carries the `card_title` captured at write time.

It is a read: no `write_tx`, no board version, no event. `access.board_access()` has already
resolved the board, so a board that is not there is answered 404 by the dependency and never here.

The card modal's feed is this same function with `card_id` set, not a second query: Section 4.2
declares one endpoint for both readers, because the drawer's feed and the modal's differ by that
one `WHERE` alone.
"""

import json
from typing import Any, NamedTuple

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from kanban.models import Activity

#: `GET /api/boards/{board_id}/activity`: the documented default page size (Section 4.2) and the
#: Section 4.1 cap a caller may ask for.
DEFAULT_ACTIVITY_LIMIT = 50
MAX_ACTIVITY_LIMIT = 200


class ActivityFeed(NamedTuple):
    """One cursor page of the feed (Sections 4.2 and 4.1).

    `next_before` is the `activities.id` of the last row of a full page and `None` once the feed
    has reached its end; no row is ever skipped, so the last row read is also the last item
    emitted.
    """

    items: list[dict[str, Any]]
    next_before: int | None


def _feed_statement(
    *, board_id: int, card_id: int | None, before: int | None, limit: int
) -> Select[tuple[Activity]]:
    """The Section 4.2 query: one board's rows, newest first, narrowed to one card on request.

    `ORDER BY id DESC` over `ix_activities_board_id_desc` (Section 3.4), and `id < before` is the
    cursor, so a page can neither repeat nor skip a row while new activity arrives above it.
    """
    statement = (
        select(Activity)
        .where(Activity.board_id == board_id)
        .order_by(Activity.id.desc())
        .limit(limit)
        .execution_options(populate_existing=True)
    )
    if card_id is not None:
        statement = statement.where(Activity.card_id == card_id)
    if before is not None:
        statement = statement.where(Activity.id < before)
    return statement


def activity_out(row: Activity) -> dict[str, Any]:
    """One row as `ActivityOut` carries it: the stored columns with `data` parsed.

    The only place an `activities` row becomes that wire shape (CLAUDE.md section 3); the SSE
    payload of Section 4.8 is a different shape and `events.py` builds it.
    """
    return {
        "id": row.id,
        "board_id": row.board_id,
        "card_id": row.card_id,
        "list_id": row.list_id,
        "type": row.type,
        "data": json.loads(row.data),
        "board_version": row.board_version,
        "created_at": row.created_at,
    }


def board_activity(
    db: Session,
    *,
    board_id: int,
    card_id: int | None = None,
    before: int | None = None,
    limit: int = DEFAULT_ACTIVITY_LIMIT,
) -> ActivityFeed:
    """One page of activity, newest first, cursored on `activities.id` (Section 4.2).

    Every row of the board is returned, including the reorder rows Section 3.8 marks "not shown in
    feed" (`card.reordered`, `item.moved`): which sentences a reader
    sees is `lib/activity.ts`'s decision, and filtering them here would make the same rule live in
    two places and leave the client unable to page reliably. `card_id` narrows the feed to one
    card's rows, which is what the card modal's feed is (Section 4.2). Raises nothing: a
    board with no activity is an empty page.
    """
    rows = (
        db.execute(_feed_statement(board_id=board_id, card_id=card_id, before=before, limit=limit))
        .scalars()
        .all()
    )
    return ActivityFeed(
        items=[activity_out(row) for row in rows],
        next_before=rows[-1].id if len(rows) == limit else None,
    )
