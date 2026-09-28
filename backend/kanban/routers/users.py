"""`GET /api/users` - the directory behind the Members and Share popovers (Section 4.2).

The response is always `PublicUserOut`: id, username, full name, initials and avatar colour. No
route here ever returns another user's email address; only `/api/auth/*`, which describes the
caller to themselves, carries one.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from kanban import auth
from kanban.db import get_db
from kanban.schemas.auth import UserListOut
from kanban.schemas.common import PublicUserOut
from kanban.services import users as service

router = APIRouter(tags=["users"])

Db = Annotated[Session, Depends(get_db)]


@router.get("/users", response_model=UserListOut)
def list_users(
    _user: auth.CurrentUser,
    db: Db,
    q: Annotated[str | None, Query(min_length=service.MIN_QUERY_LENGTH)] = None,
    limit: Annotated[int, Query(ge=1, le=service.MAX_USER_LIMIT)] = service.DEFAULT_USER_LIMIT,
) -> UserListOut:
    """Every registered user, or those matching `q`, for the member pickers (Section 4.2).

    Authentication is required: the directory lists everybody on the install, so it is not public.
    """
    return UserListOut(
        items=[
            PublicUserOut.model_validate(row) for row in service.list_users(db, q=q, limit=limit)
        ]
    )
