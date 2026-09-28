"""Comments and the card activity feed (Sections 4.5, 4.6 and 3.8).

Every mutation opens exactly one `write_tx()` and records its row through `activity.record()`
(CLAUDE.md section 3). The feed is deliberately **not** a merge of two tables: `activities` is the
only thing paginated, `activities.id` is the only cursor, and a `comment.added` row is resolved to
its body through `data.comment_id`, so there is one id space and a comment can never sort out of
step with the activity that announced it.

`auth.board_access` has already decided who may reach these functions, with one exception:
`update_comment` and `delete_comment` are rules about *which comment row* the caller may touch
("their own", "their own or anybody's as a board admin"), so they compare the author themselves
and the delete takes the caller's role, exactly as `services.boards.remove_member` does for
"Leave board".

An `activities` row becomes an `ActivityOut` in exactly one place, `services.activity_feed`
`activity_out()`: the card feed here and the board feed of Section 4.3 answer with the same
schema, so this module joins the actor into its own statement and calls that builder.
"""

from typing import Any, NamedTuple

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from kanban import activity
from kanban.constants import ROLES
from kanban.db import write_tx
from kanban.errors import Forbidden, NotFound
from kanban.models import Activity, Card, Comment, User, utcnow_iso
from kanban.services import activity_feed

#: `constants.ROLES` is ordered most privileged first, so the admin role is its first entry.
ADMIN = ROLES[0]

#: How much of a body `activities.data.body_preview` keeps (Section 3.8). The preview exists for
#: the board feed and the SSE stream, which never join `comments`; the card feed renders the full
#: body from the row itself, so this is never the copy anybody reads a comment from.
BODY_PREVIEW_CHARS = 140

#: `GET /api/cards/{card_id}/feed`: the documented default and the Section 4.1 cursor cap.
DEFAULT_FEED_LIMIT = 30
MAX_FEED_LIMIT = 200

#: The one type the feed shows while details are hidden. The *exact* type, never the `comment.`
#: prefix, so the `comment.edited` / `comment.deleted` rows stay hidden with the other details.
COMMENT_TYPE = "comment.added"


class CommentMutation(NamedTuple):
    """What a comment mutation returns: the row plus the version it produced (Section 4.1)."""

    item: dict[str, Any]
    board_version: int


class CardFeed(NamedTuple):
    """One cursor page of the card feed (Sections 4.5 and 4.1).

    `next_before` is the `activities.id` of the last row *read*, not of the last item emitted, so
    a page whose rows were all skipped still advances the cursor; `None` once the end is reached.
    """

    items: list[dict[str, Any]]
    next_before: int | None


def _preview(body: str) -> str:
    """The `body_preview` of a `comment.*` activity row (Section 3.8)."""
    return body[:BODY_PREVIEW_CHARS]


def _author(db: Session, user_id: int) -> User | None:
    """The `users` row behind `CommentOut.user`, which `PublicUserOut` reads the five columns off.

    `comments.user_id` is `ON DELETE CASCADE`, so a comment never outlives its author and this is
    never `None` in practice; it is typed as the joined actor of an activity row is, and returning
    the row rather than a dict keeps "never an email address" in the one schema that owns it.
    """
    return db.get(User, user_id)


def _comment_out(db: Session, comment: Comment) -> dict[str, Any]:
    """The `CommentOut` of Section 4.6 for one row."""
    return {
        "id": comment.id,
        "card_id": comment.card_id,
        "user": _author(db, comment.user_id),
        "body": comment.body,
        "created_at": comment.created_at,
        "edited_at": comment.edited_at,
    }


def _load_card(db: Session, card_id: int) -> Card:
    """Re-read the card a comment belongs to, under the write lock (Section 6.7.2 step 6)."""
    card = db.get(Card, card_id, populate_existing=True)
    if card is None:  # pragma: no cover - the router's dependency resolved it a moment ago
        raise NotFound("not_found", "That card does not exist.")
    return card


def _load_comment(db: Session, comment_id: int) -> Comment:
    """Re-read one comment, never from the identity map (`expire_on_commit` is off)."""
    comment = db.get(Comment, comment_id, populate_existing=True)
    if comment is None:  # pragma: no cover - the router's dependency resolved it a moment ago
        raise NotFound("not_found", "That comment does not exist.")
    return comment


def create_comment(
    db: Session, user: User, *, board_id: int, card_id: int, body: str
) -> CommentMutation:
    """Add a comment to a card (Section 4.6). Observers may comment, which the router allows.

    The `comment.added` row carries the new `comment_id` - what the feed joins on - and a
    `body_preview`, never the whole body: the body lives in `comments` and is read from there, so
    an edit cannot leave two versions of it behind. Raises `NotFound` when the card is gone and
    `Busy` (503) on a lock timeout.
    """
    with write_tx(db, [board_id]) as ctx:
        card = _load_card(db, card_id)
        comment = Comment(card_id=card_id, user_id=user.id, body=body)
        db.add(comment)
        db.flush()  # the id the activity row points at
        activity.record(
            ctx,
            "comment.added",
            user_id=user.id,
            card_id=card_id,
            list_id=card.list_id,
            card_title=card.title,
            comment_id=comment.id,
            body_preview=_preview(body),
        )
        comment_id = comment.id
    return CommentMutation(
        item=_comment_out(db, _load_comment(db, comment_id)),
        board_version=ctx.board_version,
    )


def update_comment(
    db: Session, user: User, *, board_id: int, comment_id: int, body: str
) -> CommentMutation:
    """Edit one's own comment, stamping `edited_at` (Section 4.6).

    The author is the only person who may edit, board admins included - an admin may remove a
    comment but never put words in somebody's mouth - so any other caller raises `Forbidden`
    (403). A body equal to the stored one is not an edit: `edited_at` is left alone and nothing is
    recorded, so re-saving an unchanged comment never adds "(edited)" or a feed entry. Raises
    `NotFound` when the comment is gone and `Busy` (503) on a lock timeout.
    """
    with write_tx(db, [board_id]) as ctx:
        comment = _load_comment(db, comment_id)
        if comment.user_id != user.id:
            raise Forbidden("forbidden", "Only the author can edit a comment.")
        if body != comment.body:
            card = _load_card(db, comment.card_id)
            comment.body = body
            comment.edited_at = utcnow_iso()
            activity.record(
                ctx,
                "comment.edited",
                user_id=user.id,
                card_id=card.id,
                list_id=card.list_id,
                card_title=card.title,
                comment_id=comment.id,
                body_preview=_preview(body),
            )
    return CommentMutation(
        item=_comment_out(db, _load_comment(db, comment_id)),
        board_version=ctx.board_version,
    )


def delete_comment(
    db: Session, user: User, *, board_id: int, comment_id: int, actor_role: str
) -> None:
    """Delete a comment: one's own, or anybody's as a board admin (Section 4.6).

    The `comment.deleted` row keeps the `comment_id` and a `body_preview`, so the details view
    still renders "deleted a comment from this card" once the row itself is gone, while the card
    feed skips the orphaned `comment.added` row rather than rendering an empty bubble (4.5).
    Raises `Forbidden` (403) for anybody else, `NotFound` when the comment is gone and `Busy`
    (503) on a lock timeout.
    """
    with write_tx(db, [board_id]) as ctx:
        comment = _load_comment(db, comment_id)
        if comment.user_id != user.id and actor_role != ADMIN:
            raise Forbidden("forbidden", "Only the author or a board admin can delete a comment.")
        card = _load_card(db, comment.card_id)
        activity.record(
            ctx,
            "comment.deleted",
            user_id=user.id,
            card_id=card.id,
            list_id=card.list_id,
            card_title=card.title,
            comment_id=comment.id,
            body_preview=_preview(comment.body),
        )
        db.delete(comment)


def _feed_statement(*, card_id: int, before: int | None, limit: int, details: bool) -> Select[Any]:
    """The Section 4.5 feed query: one card's `activities`, newest first, comment and actor joined.

    `LEFT JOIN comments ON comments.id = json_extract(data, '$.comment_id')` is what makes one
    cursor enough: the announcement row is what paginates and the body simply rides along, or
    comes back NULL once the comment has been deleted. The actor is joined in the same statement -
    outer, because `activities.user_id` is `ON DELETE SET NULL` - so a page costs one query rather
    than one `db.get(User, ...)` per row, exactly as the board feed reads it.
    """
    statement = (
        select(Activity, Comment, User)
        .outerjoin(Comment, Comment.id == func.json_extract(Activity.data, "$.comment_id"))
        .outerjoin(User, User.id == Activity.user_id)
        .where(Activity.card_id == card_id)
        .order_by(Activity.id.desc())
        .limit(limit)
    )
    if not details:
        statement = statement.where(Activity.type == COMMENT_TYPE)
    if before is not None:
        statement = statement.where(Activity.id < before)
    return statement


def card_feed(
    db: Session,
    *,
    card_id: int,
    before: int | None = None,
    limit: int = DEFAULT_FEED_LIMIT,
    details: bool = True,
) -> CardFeed:
    """One page of a card's feed, newest first, cursored on `activities.id` (Section 4.5).

    `details=False` returns comments only ("Hide details"), filtering on the exact type
    `comment.added` so the `comment.edited` / `comment.deleted` rows stay hidden with the rest.
    A `comment.added` row whose comment has since been deleted is skipped, which is why
    `next_before` counts rows read rather than items emitted. No board id and no write: it is a
    read, and `auth.card_access(observer)` has already authorised it.
    """
    rows = db.execute(
        _feed_statement(card_id=card_id, before=before, limit=limit, details=details)
    ).all()
    items: list[dict[str, Any]] = []
    for row, comment, actor in rows:
        if row.type == COMMENT_TYPE:
            if comment is None:  # the comment was deleted; its announcement goes with it
                continue
            items.append({"kind": "comment", "comment": _comment_out(db, comment)})
        else:
            items.append({"kind": "activity", "activity": activity_feed.activity_out(row, actor)})
    return CardFeed(items=items, next_before=rows[-1][0].id if len(rows) == limit else None)
