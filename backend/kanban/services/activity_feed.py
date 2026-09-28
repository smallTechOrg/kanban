"""The board activity feed (Sections 4.3, 2.3.4 and 3.8): the read side of the activity log.

`kanban/activity.py` `record()` is the only writer of an `activities` row and the only place the
Section 3.8 vocabulary lives (CLAUDE.md section 3); this module adds no type, no sentence and no
`data` key of its own. It answers one question - "what happened on this board, newest first" -
and hands the rows back exactly as they were stored, with `data` parsed from its JSON text, so
`lib/activity.ts` renders every sentence from `type` + `data` and a row about a card that has
since been deleted still carries the `card_title` captured at write time.

It is a read: no `write_tx`, no board version, no event. `auth.board_access(observer)` has already
decided who may reach it, so a non-member is answered 404 by the dependency and never here.

The actor travels with the row from one statement (`LEFT JOIN users`), not a `db.get(User, ...)`
per row: a 50-row page of a busy board is otherwise 50 extra round trips, and the join must be an
outer one because `activities.user_id` is `ON DELETE SET NULL` - a row outlives the account that
wrote it, which is why `ActivityOut.user` is nullable.
"""

import json
from typing import Any, NamedTuple

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from kanban.models import Activity, User

#: `GET /api/boards/{board_id}/activity`: the documented default page size (Section 4.3) and the
#: Section 4.1 cap a caller may ask for.
DEFAULT_ACTIVITY_LIMIT = 50
MAX_ACTIVITY_LIMIT = 200


class ActivityFeed(NamedTuple):
    """One cursor page of the board feed (Sections 4.3 and 4.1).

    `next_before` is the `activities.id` of the last row of a full page and `None` once the feed
    has reached its end; unlike the card feed, no row of this page is ever skipped, so the last
    row read is also the last item emitted.
    """

    items: list[dict[str, Any]]
    next_before: int | None


def _feed_statement(
    *, board_id: int, card_id: int | None, before: int | None, limit: int
) -> Select[tuple[Activity, User | None]]:
    """The Section 4.3 query: one board's rows, newest first, with the actor joined in.

    `ORDER BY id DESC` over `ix_activities_board_id_desc` (Section 3.4), and `id < before` is the
    cursor, so a page can neither repeat nor skip a row while new activity arrives above it.
    """
    statement = (
        select(Activity, User)
        .outerjoin(User, User.id == Activity.user_id)
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


def activity_out(row: Activity, actor: User | None) -> dict[str, Any]:
    """One row as `ActivityOut` carries it: the stored columns with `data` parsed.

    The only place an `activities` row becomes that wire shape (CLAUDE.md section 3): the board
    feed here and the card feed of `services/comments.py` answer with the same schema, so
    `card_feed()` joins its actor in and calls this rather than keeping a second copy.

    `user` is the joined `users` row itself, which `PublicUserOut` (`from_attributes`) reads the
    five public columns off, so the "never an email address" rule of Section 4.2 stays in the one
    schema that owns it rather than being re-spelled as a dict here.
    """
    return {
        "id": row.id,
        "board_id": row.board_id,
        "card_id": row.card_id,
        "list_id": row.list_id,
        "user": actor,
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
    """One page of a board's activity, newest first, cursored on `activities.id` (Section 4.3).

    Every row of the board is returned, including the reorder rows Section 3.8 marks "not shown in
    feed" (`card.reordered`, `checklist.moved`, `checklist.item_moved`): which sentences a reader
    sees is `lib/activity.ts`'s decision, and filtering them here would make the same rule live in
    two places and leave the client unable to page reliably. `card_id` narrows the feed to one
    card's rows (Section 4.3). Raises nothing: a board with no activity is an empty page.
    """
    rows = db.execute(
        _feed_statement(board_id=board_id, card_id=card_id, before=before, limit=limit)
    ).all()
    return ActivityFeed(
        items=[activity_out(row, actor) for row, actor in rows],
        next_before=rows[-1][0].id if len(rows) == limit else None,
    )
