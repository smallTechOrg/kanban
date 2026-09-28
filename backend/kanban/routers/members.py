"""Card members and the watch toggle (Section 4.5).

Thin by contract (Section 6.4): every handler resolves an access dependency, calls one function of
`services.members` and returns its result. Both paths are keyed by a card id, so the dependency is
the `auth.card_access` factory the card routes use - the card's board, the caller's membership, the
role and the closed-board guard are decided there and nowhere else (CLAUDE.md section 3), and a
missing card and a non-member both answer 404 `not_found` so ids cannot be enumerated.

Assigning needs `member`; watching is per-user state, so `observer` suffices (Section 4.5). It is
not `allow_closed`, unlike the board star: Section 4.1 exempts exactly four routes from the
closed-board guard - reopen, board delete, star/unstar and "Leave board" - and this is not one of
them, so watching a card on a closed board answers 409 `conflict` like every other mutation there.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Path
from sqlalchemy.orm import Session

from kanban.auth import BoardCtx, Role, card_access, current_user
from kanban.db import get_db
from kanban.models import User
from kanban.schemas.members import CardMembersOut, WatchOut
from kanban.services import members as service

router = APIRouter(tags=["members"])

CurrentUser = Annotated[User, Depends(current_user)]
Db = Annotated[Session, Depends(get_db)]
CardId = Annotated[int, Path(ge=1)]
UserId = Annotated[int, Path(ge=1)]

#: Assigning somebody to a card is an ordinary card mutation.
CardWriteAccess = Annotated[BoardCtx, Depends(card_access(Role.member))]
#: Watching is per-user state: an observer may watch a card they cannot edit (Section 4.5).
CardWatchAccess = Annotated[BoardCtx, Depends(card_access(Role.observer))]


@router.put("/cards/{card_id}/members/{user_id}", response_model=CardMembersOut)
def assign_member(
    card_id: CardId, user_id: UserId, access: CardWriteAccess, user: CurrentUser, db: Db
) -> CardMembersOut:
    """Put a board member on a card; sending it twice changes nothing (Section 4.5)."""
    member_ids, board_version = service.assign_member(
        db, user, card_id=card_id, board_id=access.board_id, user_id=user_id
    )
    return CardMembersOut(member_ids=member_ids, board_version=board_version)


@router.delete("/cards/{card_id}/members/{user_id}", response_model=CardMembersOut)
def unassign_member(
    card_id: CardId, user_id: UserId, access: CardWriteAccess, user: CurrentUser, db: Db
) -> CardMembersOut:
    """Take somebody off a card; somebody the card does not carry is a no-op (Section 4.5)."""
    member_ids, board_version = service.unassign_member(
        db, user, card_id=card_id, board_id=access.board_id, user_id=user_id
    )
    return CardMembersOut(member_ids=member_ids, board_version=board_version)


@router.put("/cards/{card_id}/watch", response_model=WatchOut)
def watch_card(card_id: CardId, access: CardWatchAccess, user: CurrentUser, db: Db) -> WatchOut:
    """Watch a card for the caller. Per-user state: no version bump, no activity, no event."""
    return WatchOut(is_watching=service.watch_card(db, user, card_id=card_id))


@router.delete("/cards/{card_id}/watch", response_model=WatchOut)
def unwatch_card(card_id: CardId, access: CardWatchAccess, user: CurrentUser, db: Db) -> WatchOut:
    """Stop watching a card; the same per-user write as `watch_card`."""
    return WatchOut(is_watching=service.unwatch_card(db, user, card_id=card_id))
