"""Card members and the per-user watch flag (Sections 4.5 and 4.1).

Two rules of very different shape live here, which is why they share one module: both are rows of
the `card_members` / `card_watchers` join tables that hang off a card.

* **Assignment is board state.** `assign_member` and `unassign_member` open exactly one
  `write_tx()`, record one `activities` row through `activity.record()` and answer with the card's
  whole `member_ids` array plus the new `boards.version`, exactly as the two label toggles of
  Section 4.5 do. Both are idempotent: repeating a `PUT` or sending a `DELETE` for somebody who is
  not on the card writes no join row and records no activity (the version still moves, because the
  request is still one `write_tx`).
* **Watching is per-user state.** `watch_card` and `unwatch_card` are the third of the four writes
  Section 4.1 exempts from `write_tx`: one statement inside `user_write()`, no version bump, no
  activity row and no event, so one reader's eye icon never opens a version gap on another's board.
  The `card.watched` / `card.unwatched` activity types stay reserved and unwritten in v1
  (Section 3.8), and observer role suffices - which is the dependency `routers/members.py`
  declares, not a role comparison here.

Permission checks are not repeated in this module: `auth.card_access` has resolved the card's board
and decided by the time a function here is called, which is why each one takes the `board_id` the
router resolved (CLAUDE.md section 3). "The user must be a board member" is a different rule - it
is about the *assignee*, not the caller - and `_board_member()` below is where it lives for a single
user, because the activity row needs that user's `full_name` denormalised into `data` (Section 3.8)
and the composer's list validator in `services/cards.py` answers with ids only.
"""

from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from kanban import activity
from kanban.db import user_write, write_tx
from kanban.errors import BadRequest, NotFound
from kanban.models import BoardMember, Card, CardMember, CardWatcher, User


def _locked_card(db: Session, *, card_id: int, board_id: int) -> Card:
    """The card, re-read inside the open write transaction (Section 6.7.2 step 6).

    `expire_on_commit` is off on the session, so an instance left over from an earlier transaction
    still carries pre-commit values; `populate_existing` forces the SELECT.
    """
    row = db.get(Card, card_id, populate_existing=True)
    if row is None or row.board_id != board_id:  # pragma: no cover - lost a race with a deleter
        raise NotFound("not_found", "That card does not exist.")
    return row


def _board_member(db: Session, *, board_id: int, user_id: int) -> User:
    """The assignee's `users` row, proving they are a member of this board (Section 4.5).

    Raises `BadRequest` (400 `bad_request`) when they are not, with the same message and
    `details.member_ids` shape the card composer answers with, so the client renders one error for
    both. The row itself comes back because `card.member_added` denormalises `member_name`.
    """
    row = db.execute(
        select(User)
        .join(BoardMember, BoardMember.user_id == User.id)
        .where(BoardMember.board_id == board_id, User.id == user_id)
    ).scalar_one_or_none()
    if row is None:
        raise BadRequest(
            "bad_request", "That user is not a member of this board.", {"member_ids": [user_id]}
        )
    return row


def _assigned_row_id(db: Session, *, card_id: int, user_id: int) -> int | None:
    """The `card_members` row joining these two, or None - what makes both toggles idempotent."""
    return db.execute(
        select(CardMember.id).where(CardMember.card_id == card_id, CardMember.user_id == user_id)
    ).scalar_one_or_none()


def card_member_ids(db: Session, *, card_id: int) -> list[int]:
    """The card's assignees in the `user_id` order `CardSummary.member_ids` carries (Section 4.5).

    Both toggles answer with this array so the client patches one list into its cache, exactly as
    `services.cards.card_label_ids` backs the two label toggles.
    """
    return list(
        db.execute(
            select(CardMember.user_id)
            .where(CardMember.card_id == card_id)
            .order_by(CardMember.user_id)
        ).scalars()
    )


def assign_member(
    db: Session, user: User, *, card_id: int, board_id: int, user_id: int
) -> tuple[list[int], int]:
    """Put a board member on a card, idempotently (Section 4.5).

    Activity `card.member_added` only when the card did not carry them already, with `self: true`
    when the assignee is the caller ("joined this card", Section 3.8) - which is what the Join
    button and the `Space` shortcut send. Raises `BadRequest` (400) when `user_id` is not a member
    of this board and `Busy` (503) when the write lock is unavailable.
    """
    with write_tx(db, [board_id]) as ctx:
        card = _locked_card(db, card_id=card_id, board_id=board_id)
        assignee = _board_member(db, board_id=board_id, user_id=user_id)
        if _assigned_row_id(db, card_id=card_id, user_id=user_id) is None:
            db.add(CardMember(card_id=card_id, user_id=user_id))
            activity.record(
                ctx,
                "card.member_added",
                user_id=user.id,
                card_id=card_id,
                card_title=card.title,
                member_id=user_id,
                member_name=assignee.full_name,
                **{"self": user_id == user.id},
            )
    return card_member_ids(db, card_id=card_id), ctx.board_version


def unassign_member(
    db: Session, user: User, *, card_id: int, board_id: int, user_id: int
) -> tuple[list[int], int]:
    """Take somebody off a card, idempotently (Section 4.5).

    Removing a user the card does not carry - including one who has since left the board - is a
    no-op that records nothing and answers with the card's unchanged assignees, because `DELETE` on
    an association is idempotent (Section 4.1). Activity `card.member_removed` otherwise, with
    `self: true` for "left this card". Raises `Busy` (503).
    """
    with write_tx(db, [board_id]) as ctx:
        card = _locked_card(db, card_id=card_id, board_id=board_id)
        row_id = _assigned_row_id(db, card_id=card_id, user_id=user_id)
        if row_id is not None:
            assignee = db.get(User, user_id, populate_existing=True)
            activity.record(
                ctx,
                "card.member_removed",
                user_id=user.id,
                card_id=card_id,
                card_title=card.title,
                member_id=user_id,
                member_name=assignee.full_name if assignee else "",
                **{"self": user_id == user.id},
            )
            db.execute(delete(CardMember).where(CardMember.id == row_id))
    return card_member_ids(db, card_id=card_id), ctx.board_version


def watch_card(db: Session, user: User, *, card_id: int) -> bool:
    """Start watching a card for the caller; idempotent (Sections 4.5 and 4.1).

    Per-user state, not board state: one `card_watchers` upsert inside `user_write()`, no version
    bump, no activity row and no event. Observer role suffices, which the route declares.
    """
    statement = sqlite_insert(CardWatcher).values(card_id=card_id, user_id=user.id)
    with user_write(db):
        db.execute(
            statement.on_conflict_do_nothing(
                index_elements=[CardWatcher.card_id, CardWatcher.user_id]
            )
        )
    return True


def unwatch_card(db: Session, user: User, *, card_id: int) -> bool:
    """Stop watching a card for the caller; idempotent, and the same per-user write as above."""
    with user_write(db):
        db.execute(
            delete(CardWatcher).where(
                CardWatcher.card_id == card_id, CardWatcher.user_id == user.id
            )
        )
    return False
