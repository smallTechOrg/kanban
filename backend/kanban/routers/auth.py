"""`/api/auth/*` - register, login, logout, the current user and the dev login (Section 4.2).

Thin by contract (Section 6.4): each handler validates its body, calls `services.users`, and hands
the session work to `kanban/auth.py`. The only HTTP detail these handlers own is the cookie, which
`auth.set_session_cookie` / `auth.clear_session_cookie` write.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from kanban import auth
from kanban.config import settings
from kanban.db import get_db
from kanban.models import User
from kanban.schemas.auth import (
    DevLoginIn,
    LoginIn,
    ProfileUpdateIn,
    RegisterIn,
    SessionOut,
    UserOut,
)
from kanban.services import users as service

router = APIRouter(prefix="/auth", tags=["auth"])

Db = Annotated[Session, Depends(get_db)]


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, request: Request, response: Response, db: Db) -> UserOut:
    """Create an account, sign the caller in and set the session cookie (Section 4.2).

    403 `signup_disabled` when `KANBAN_ALLOW_SIGNUP=0` and the install already has a user.
    """
    user = service.register_user(
        db,
        email=str(body.email),
        username=body.username,
        full_name=body.full_name,
        password=body.password,
        enforce_signup_lock=True,
    )
    _open_session(db, user, request, response)
    return UserOut.model_validate(user)


@router.post("/login", response_model=SessionOut)
def login(body: LoginIn, request: Request, response: Response, db: Db) -> SessionOut:
    """Verify the credentials, open a session and return the caller plus the raw bearer token."""
    user = service.authenticate(
        db, email_or_username=body.email_or_username, password=body.password
    )
    token = _open_session(db, user, request, response)
    return SessionOut(user=UserOut.model_validate(user), token=token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def logout(session_id: auth.CurrentSessionId, db: Db) -> Response:
    """Delete this session's row and send `kb_session=; Max-Age=0` (Section 4.2)."""
    auth.delete_session(db, session_id)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    auth.clear_session_cookie(response)
    return response


@router.get("/me", response_model=UserOut)
def read_me(user: auth.CurrentUser) -> UserOut:
    """The signed-in account; the SPA's first call on boot (Section 5.4.1)."""
    return UserOut.model_validate(user)


@router.patch("/me", response_model=UserOut)
def update_me(
    body: ProfileUpdateIn, user: auth.CurrentUser, session_id: auth.CurrentSessionId, db: Db
) -> UserOut:
    """Update the caller's name, avatar colour or password, backing `ProfileModal`."""
    updated = service.update_profile(
        db, user, current_session_id=session_id, **body.model_dump(exclude_unset=True)
    )
    return UserOut.model_validate(updated)


if settings.is_dev:
    # Registered only when `KANBAN_ENV=dev`, so the route does not exist in production at all
    # (Sections 4.2 and 6.6): outside dev the path is an ordinary 404 `not_found`.
    @router.post("/dev-login", response_model=UserOut)
    def dev_login(body: DevLoginIn, request: Request, response: Response, db: Db) -> UserOut:
        """Sign in as `username` with no password. Playwright only; 404 for an unknown user."""
        user = service.get_by_username(db, body.username)
        _open_session(db, user, request, response)
        return UserOut.model_validate(user)


def _open_session(db: Session, user: User, request: Request, response: Response) -> str:
    """Create the session row, set the cookie and return the raw token for bearer clients."""
    _, token = auth.create_session(db, user, user_agent=request.headers.get("user-agent"))
    auth.set_session_cookie(response, token)
    return token
