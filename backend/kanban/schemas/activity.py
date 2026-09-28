"""`GET /api/boards/{board_id}/activity`: the board activity feed of Sections 4.3 and 2.3.4.

Section 4.3 types the response as `{items: ActivityOut[], next_before}`, and `ActivityOut` is
already declared - with exactly this shape, the stored row plus its actor as a `PublicUserOut` -
in `schemas/comments.py`, which arrived first with the card feed of Section 4.5. Restating it here
would put the one wire shape of an `activities` row in two modules, which CLAUDE.md section 3
forbids, so `BoardActivityOut` **is** that model under the name the board feed asks for: one
OpenAPI schema, one generated TypeScript type, and `api/types.ts` keeps naming it `ActivityOut`.

Only the page wrapper is new: the card feed answers with the two-shape `FeedItemOut` union
(a `comment.added` row is rendered from the comment it points at), while the board feed renders
every row from `type` + `data` alone - the board drawer shows sentences, never comment bubbles -
so `CardFeedOut` is not the shape this endpoint can reuse.
"""

from pydantic import BaseModel

from kanban.schemas.comments import ActivityOut

#: One `activities` row as the board feed carries it (Section 4.3): the row with `data` parsed back
#: to an object and `user` as a `PublicUserOut`, or `None` once the actor's account is gone
#: (`activities.user_id` is `ON DELETE SET NULL`). The denormalised names in `data` are what let
#: `lib/activity.ts` render the Section 3.8 sentence of a card that has since been deleted.
BoardActivityOut = ActivityOut


class ActivityPage(BaseModel):
    """One cursor page of the board activity feed (Sections 4.3 and 4.1).

    Newest first (`ORDER BY id DESC`). `next_before` is the `activities.id` to page before, which
    is the last row's id when the page came back full and `null` once the end is reached - what
    tells `BoardActivityFeed`'s infinite scroll to stop asking.
    """

    items: list[BoardActivityOut]
    next_before: int | None = None
