"""Comments and the card activity feed (Sections 4.5 and 4.6).

Thin by contract (Section 6.4): a handler resolves its access dependency, calls one function of
`services.comments` and wraps the result as `Mutated` or the cursor page of Section 4.1. The card
routes reuse `auth.card_access` and the two `/api/comments/{comment_id}` routes
`auth.comment_access`, which resolves the comment's board and adds no rule of its own - who may
edit or delete *which* comment is decided in `services/comments.py`.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, status
from sqlalchemy.orm import Session

from kanban.auth import BoardCtx, Role, card_access, comment_access, current_user
from kanban.db import get_db
from kanban.models import User
from kanban.schemas.comments import (
    CardFeedOut,
    CommentCreateIn,
    CommentMutated,
    CommentOut,
    CommentUpdateIn,
)
from kanban.services import comments as service

router = APIRouter(tags=["comments"])

CurrentUser = Annotated[User, Depends(current_user)]
Db = Annotated[Session, Depends(get_db)]
CardId = Annotated[int, Path(ge=1)]
CommentId = Annotated[int, Path(ge=1)]


#: Commenting, editing and deleting are all open to an observer: Section 4.6 says "Observers may
#: comment", and the author of a comment may be one. Who owns the row is the service's decision.
CommentAccess = Annotated[BoardCtx, Depends(comment_access(Role.observer))]
#: A card's comments and its feed need only `observer`; the feed is a read, so never refused.
CardAccess = Annotated[BoardCtx, Depends(card_access(Role.observer))]


@router.post(
    "/cards/{card_id}/comments",
    response_model=CommentMutated,
    status_code=status.HTTP_201_CREATED,
)
def create_comment(
    card_id: CardId, body: CommentCreateIn, access: CardAccess, user: CurrentUser, db: Db
) -> CommentMutated:
    """Comment on a card (Section 4.6). Activity `comment.added`, which the feed joins on."""
    result = service.create_comment(
        db, user, board_id=access.board_id, card_id=card_id, body=body.body
    )
    return CommentMutated(
        item=CommentOut.model_validate(result.item), board_version=result.board_version
    )


@router.patch("/comments/{comment_id}", response_model=CommentMutated)
def update_comment(
    comment_id: CommentId, body: CommentUpdateIn, access: CommentAccess, user: CurrentUser, db: Db
) -> CommentMutated:
    """Edit one's own comment; 403 `forbidden` for anybody else's (Section 4.6)."""
    result = service.update_comment(
        db, user, board_id=access.board_id, comment_id=comment_id, body=body.body
    )
    return CommentMutated(
        item=CommentOut.model_validate(result.item), board_version=result.board_version
    )


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(comment_id: CommentId, access: CommentAccess, user: CurrentUser, db: Db) -> None:
    """Delete one's own comment, or anybody's as a board admin; 403 otherwise (Section 4.6)."""
    service.delete_comment(
        db,
        user,
        board_id=access.board_id,
        comment_id=comment_id,
        actor_role=access.member.role,
    )


@router.get("/cards/{card_id}/feed", response_model=CardFeedOut)
def read_card_feed(
    card_id: CardId,
    access: CardAccess,
    db: Db,
    before: Annotated[int | None, Query(ge=1, description="An activities.id to page before")] = (
        None
    ),
    limit: Annotated[int, Query(ge=1, le=service.MAX_FEED_LIMIT)] = service.DEFAULT_FEED_LIMIT,
    details: Annotated[bool, Query(description="0 for comments only ('Hide details')")] = True,
) -> CardFeedOut:
    """One page of the card's activity feed, newest first (Sections 4.5 and 2.6.3)."""
    page = service.card_feed(db, card_id=card_id, before=before, limit=limit, details=details)
    return CardFeedOut(items=page.items, next_before=page.next_before)
