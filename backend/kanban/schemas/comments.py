"""Comments and the card activity feed (Sections 4.5, 4.6 and 3.8).

The feed is one paginated view over `activities`, not over two id spaces: every comment has a
`comment.added` row carrying `data.comment_id`, so `activities.id` is the only cursor and a
`comment.added` row is rendered from the joined `comments` row while every other row is rendered
from `type` + `data` (Section 3.8). `FeedItemOut` is that two-shape union, discriminated by
`kind` so the generated TypeScript narrows on one field.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from kanban.schemas.common import Mutated, PublicUserOut

#: Length limit from Section 4.1: a comment body is 1-16384 characters (unlike a description,
#: which may be empty - an empty comment is a deletion, not an edit).
CommentBody = Annotated[str, StringConstraints(min_length=1, max_length=16384)]


class CommentOut(BaseModel):
    """One `comments` row as the feed and every comment mutation return it (Section 4.6).

    The author travels as a whole `PublicUserOut` because a comment outlives the board member
    list the client has cached, and `edited_at` is `None` until the first edit, which is what
    makes the feed render "(edited)" (Section 2.6.3). Whether *this* caller may edit or delete it
    is not a field: it is `user.id == me.id` for edit and that or `board.my_role == "admin"` for
    delete (Section 4.6), and both operands are already in the client's caches, so a `can_edit`
    flag would be a second copy of a rule the server enforces in `services/comments.py`.
    """

    id: int
    card_id: int
    user: PublicUserOut
    body: str
    created_at: str
    edited_at: str | None


#: The wrapper of Section 4.1, parametrised once for comments.
CommentMutated = Mutated[CommentOut]


class CommentCreateIn(BaseModel):
    """`POST /api/cards/{card_id}/comments` (Section 4.6). Observers may comment."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    body: CommentBody


class CommentUpdateIn(CommentCreateIn):
    """`PATCH /api/comments/{comment_id}` (Section 4.6): the author's own edit.

    The same single required field as the create body rather than a `PATCH`-style optional one:
    there is nothing else on a comment to patch, and an absent `body` would have no meaning.
    """


class ActivityOut(BaseModel):
    """One `activities` row as the feed carries it (Section 4.6).

    `data` is the stored JSON object parsed back out, with the names denormalised at write time,
    so `lib/activity.ts` renders the sentence of the Section 3.8 table from `type` + `data` alone
    and no sentence is ever assembled on the server.
    """

    id: int
    board_id: int
    card_id: int | None
    list_id: int | None
    user: PublicUserOut | None
    type: str
    data: dict[str, Any]
    board_version: int
    created_at: str


class CommentFeedItem(BaseModel):
    """A `comment.added` row, rendered from the comment it points at (Section 4.5)."""

    kind: Literal["comment"] = "comment"
    comment: CommentOut


class ActivityFeedItem(BaseModel):
    """Any other row, rendered from `type` + `data` (Section 4.5)."""

    kind: Literal["activity"] = "activity"
    activity: ActivityOut


#: One entry of `GET /api/cards/{card_id}/feed` (Section 4.5).
FeedItemOut = Annotated[CommentFeedItem | ActivityFeedItem, Field(discriminator="kind")]


class CardFeedOut(BaseModel):
    """`GET /api/cards/{card_id}/feed`: the cursor page shape of Section 4.1.

    `next_before` is the `activities.id` of the last row this page *read* - not of the last item
    it emitted - so a page whose only row was a deleted comment still advances the cursor. It is
    `null` when the page was not full, which is how "Load more" knows to stop.
    """

    items: list[FeedItemOut]
    next_before: int | None
