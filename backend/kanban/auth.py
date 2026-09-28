"""Authentication, sessions and board authorisation (Sections 4.1, 4.2 and 6.6).

This module is the single source of truth for permission checks (CLAUDE.md section 3): no service
re-reads `board_members` to decide what a caller may do and no router compares roles by hand.
It owns

* argon2id password hashing (`hash_password`, `verify_password`, `needs_rehash`);
* the `sessions` row and the `kb_session` cookie. The raw 43-character token travels only inside
  the itsdangerous signature or an `Authorization: Bearer` header; the table stores nothing but
  its SHA-256 hex digest, so a database dump cannot be replayed as a login;
* the 30-day sliding TTL, extended at most once every 10 minutes by `current_user` inside
  `user_write(db)` - never inside the request's read snapshot - and re-sent to the browser with a
  fresh `Max-Age` whenever it is extended;
* the `current_user` / `current_session_id` / `board_access` dependencies, including the
  closed-board guard of Section 4.1, plus the six child factories - `list_access`, `card_access`,
  `label_access`, `checklist_access`, `item_access` and `comment_access` - which resolve a child
  row's board and then apply that same `board_access` check;
* `CsrfHeaderMiddleware`, which is what makes the `SameSite=Lax` cookie safe for mutations.
"""

import hashlib
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from functools import lru_cache
from typing import Annotated, Final

from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error, InvalidHashError
from fastapi import Depends, Path, Request, Response
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy import Select, delete, select, update
from sqlalchemy.orm import Session
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from kanban.config import settings
from kanban.constants import ROLES
from kanban.db import WriteCtx, get_db, user_write, write_tx
from kanban.errors import Conflict, Forbidden, NotFound, Unauthenticated, error_response
from kanban.models import (
    Attachment,
    Board,
    BoardMember,
    Card,
    Checklist,
    ChecklistItem,
    Comment,
    Label,
    List,
    User,
    UserSession,
    utcnow_iso,
)

#: Section 6.6: the documented argon2id cost parameters.
_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)

#: `secrets.token_urlsafe(32)` yields the documented 43-character token.
TOKEN_BYTES: Final[int] = 32

#: The session cookie (Section 4.1). `HttpOnly; SameSite=Lax; Path=/`, `Secure` when KANBAN_HTTPS.
COOKIE_NAME: Final[str] = "kb_session"

#: itsdangerous namespace, so a signature minted for another purpose cannot be replayed here.
_COOKIE_SALT: Final[str] = "kb_session"

#: The CSRF header every cookie-authenticated mutation must carry (Section 4.1).
CSRF_HEADER: Final[str] = "X-Requested-With"
CSRF_HEADER_VALUE: Final[str] = "fetch"

#: Methods the CSRF guard and the closed-board guard treat as mutations.
UNSAFE_METHODS: Final[frozenset[str]] = frozenset({"POST", "PUT", "PATCH", "DELETE"})

#: How stale `sessions.updated_at` must be before the TTL slides again (Sections 4.1 and 6.6).
SLIDE_AFTER: Final[timedelta] = timedelta(minutes=10)

_BEARER_PREFIX: Final[str] = "Bearer "

#: Only `/api` is guarded; the SPA, `/assets` and `/uploads` carry no cookie-authenticated writes.
_API_PREFIX: Final[str] = "/api"


class Role(StrEnum):
    """The three board roles, ranked `observer < member < admin` (Section 6.6)."""

    admin = "admin"
    member = "member"
    observer = "observer"


#: Ranks derived from `constants.ROLES` (which lists them highest first) so the ordering has one
#: source; a role added there without a matching member here fails loudly at import time.
_ROLE_RANK: Final[dict[Role, int]] = {
    Role(name): len(ROLES) - index for index, name in enumerate(ROLES)
}


@dataclass(frozen=True)
class BoardCtx:
    """What `board_access` resolves: the board row, the caller and their `board_members` row."""

    board: Board
    member: BoardMember
    user: User

    @property
    def board_id(self) -> int:
        return self.board.id

    @property
    def role(self) -> Role:
        """The caller's role on this board, as the enum rather than the raw column value."""
        return Role(self.member.role)

    def has_role(self, min_role: Role) -> bool:
        """True when the caller's role is at least `min_role` (`observer < member < admin`)."""
        return _ROLE_RANK[self.role] >= _ROLE_RANK[min_role]


# --------------------------------------------------------------------------- passwords


def hash_password(password: str) -> str:
    """Return the argon2id digest stored in `users.password_hash`."""
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """True when `password` matches the digest. A malformed digest verifies as False."""
    try:
        return _hasher.verify(password_hash, password)
    except (Argon2Error, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    """True when the digest was made with weaker parameters than today's (Section 6.6)."""
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


# --------------------------------------------------------------------------- tokens and time


def new_token() -> str:
    """A fresh raw session token; it is never stored, only signed or hashed."""
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> str:
    """The `sessions.token_hash` value: `sha256(token).hexdigest()` (Section 6.6)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@lru_cache(maxsize=1)
def _serializer() -> URLSafeTimedSerializer:
    """The cookie signer keyed by `KANBAN_SECRET`; rotating the secret logs everyone out."""
    return URLSafeTimedSerializer(settings.resolve_secret(), salt=_COOKIE_SALT)


def sign_token(token: str) -> str:
    """The cookie value: the raw token wrapped by `URLSafeTimedSerializer` (Section 4.1)."""
    return _serializer().dumps(token)


def unsign_token(value: str) -> str | None:
    """The raw token inside a cookie value, or None for a bad or tampered signature.

    No `max_age` is enforced: the signature timestamp is frozen at login while the session slides,
    so `sessions.expires_at` - re-read on every request - is the only expiry that governs.
    """
    try:
        token = _serializer().loads(value)
    except BadSignature:
        return None
    return token if isinstance(token, str) else None


def iso(moment: datetime) -> str:
    """Format an instant exactly as `models.utcnow_iso()` does (CLAUDE.md section 4)."""
    return moment.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def parse_iso(value: str) -> datetime:
    """Parse a stored ISO-8601 UTC timestamp back into an aware `datetime`."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _now() -> datetime:
    """Now, read through `utcnow_iso()` so the whole module shares one clock (tests shift it)."""
    return parse_iso(utcnow_iso())


def session_ttl() -> timedelta:
    """`KANBAN_SESSION_DAYS` as a timedelta; both `expires_at` and `Max-Age` come from it."""
    return timedelta(days=settings.session_days)


def cookie_max_age() -> int:
    """The cookie `Max-Age` in seconds, always the row's full TTL at the moment it is written."""
    return int(session_ttl().total_seconds())


# --------------------------------------------------------------------------- sessions


def create_session(db: Session, user: User, *, user_agent: str | None = None) -> tuple[int, str]:
    """Open one `sessions` row for `user` and return `(session_id, raw token)`.

    Runs in its own `write_tx(db)` with no board ids (Section 4.1): BEGIN IMMEDIATE, no version
    bump, no activity row, no event. Raises `Busy` (503) when the write lock is unavailable.
    """
    token = new_token()
    now = _now()
    with write_tx(db) as ctx:
        row = UserSession(
            token_hash=hash_token(token),
            user_id=user.id,
            user_agent=user_agent or None,
            expires_at=iso(now + session_ttl()),
            created_at=iso(now),
            updated_at=iso(now),
        )
        ctx.db.add(row)
        ctx.db.flush()  # the rowid SQLite assigned, which `current_session_id` hands to logout
        session_id = int(row.id)
    return session_id, token


def delete_session(db: Session, session_id: int) -> None:
    """Delete one session row (logout). Its own `write_tx`, no board ids (Section 4.1)."""
    with write_tx(db) as ctx:
        ctx.db.execute(delete(UserSession).where(UserSession.id == session_id))


def revoke_other_sessions(ctx: WriteCtx, user_id: int, *, keep_session_id: int | None) -> int:
    """Delete every session of `user_id` except `keep_session_id`, inside an open `write_tx`.

    A password change calls this so other devices are logged out while the caller's own session
    and cookie stay valid (Sections 4.2 and 6.6). Returns how many rows went.
    """
    statement = delete(UserSession).where(UserSession.user_id == user_id)
    if keep_session_id is not None:
        statement = statement.where(UserSession.id != keep_session_id)
    return int(ctx.db.execute(statement).rowcount)


def _slide_session(db: Session, session_id: int, now: datetime) -> None:
    """Extend one session's TTL as the fourth per-user write of Section 4.1.

    One statement inside `user_write(db)`, which ends the request's read snapshot first - so
    `current_user` never issues DML inside it - and bumps no version, records nothing and
    publishes nothing.
    """
    with user_write(db):
        db.execute(
            update(UserSession)
            .where(UserSession.id == session_id)
            .values(expires_at=iso(now + session_ttl()), updated_at=iso(now))
        )


def set_session_cookie(response: Response, token: str) -> None:
    """Send `kb_session` with the documented attributes and a full `Max-Age` (Section 4.1)."""
    response.set_cookie(
        COOKIE_NAME,
        sign_token(token),
        max_age=cookie_max_age(),
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.https,
    )


def clear_session_cookie(response: Response) -> None:
    """Send `kb_session=; Max-Age=0`, which is what logout answers with (Section 4.2)."""
    response.delete_cookie(
        COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.https,
    )


def _token_from_request(request: Request) -> tuple[str | None, bool]:
    """Return `(raw token, came from the cookie)`; a bearer header wins over a cookie."""
    header = request.headers.get("authorization", "")
    if header.startswith(_BEARER_PREFIX):
        return header[len(_BEARER_PREFIX) :].strip() or None, False
    signed = request.cookies.get(COOKIE_NAME)
    if not signed:
        return None, False
    return unsign_token(signed), True


# --------------------------------------------------------------------------- dependencies


def current_user(
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> User:
    """Resolve the caller from the signed cookie or the bearer token (Sections 4.1 and 6.6).

    Raises `Unauthenticated` (401 `unauthenticated`) when no credential is present, the cookie
    signature is bad, the token is unknown, the session has expired or its user is gone. Slides
    the TTL when `sessions.updated_at` is older than 10 minutes and, for a cookie-authenticated
    request, re-sends the cookie with a fresh `Max-Age` in that same response.
    """
    token, from_cookie = _token_from_request(request)
    if token is None:
        raise Unauthenticated("unauthenticated", "Sign in to continue.")
    row = db.execute(
        select(UserSession).where(UserSession.token_hash == hash_token(token))
    ).scalar_one_or_none()
    now = _now()
    if row is None or parse_iso(row.expires_at) <= now:
        raise Unauthenticated("unauthenticated", "Your session has expired, sign in again.")
    # Read both values out before any write: `user_write` rolls the read snapshot back, which
    # expires every ORM object the dependencies have loaded so far.
    session_id, user_id = row.id, row.user_id
    if parse_iso(row.updated_at) + SLIDE_AFTER <= now:
        _slide_session(db, session_id, now)
        if from_cookie:
            set_session_cookie(response, token)
    user = db.get(User, user_id)
    if user is None:
        raise Unauthenticated("unauthenticated", "Your session has expired, sign in again.")
    request.state.user_id = user.id  # the access log reads this (Section 6.11)
    request.state.session_id = session_id
    return user


#: What every authenticated route declares.
CurrentUser = Annotated[User, Depends(current_user)]


def current_session_id(request: Request, _user: CurrentUser) -> int:
    """The caller's own `sessions.id`, stashed by `current_user`.

    Logout and the password change are the two routes that must tell the caller's own session
    from their others.
    """
    return int(request.state.session_id)


CurrentSessionId = Annotated[int, Depends(current_session_id)]

#: What a `/api/{resource}/{id}` route binds its row id as.
PathId = Annotated[int, Path(ge=1)]
#: What every dependency below asks for its session with.
Db = Annotated[Session, Depends(get_db)]


def board_access(
    min_role: Role = Role.member, *, allow_closed: bool = False
) -> Callable[..., BoardCtx]:
    """Build the dependency that resolves a board plus the caller's role on it (Section 6.6).

    404 `not_found` when the board does not exist **or** the caller is not a member, so board ids
    cannot be enumerated; 403 `forbidden` when their role is below `min_role`; 409 `conflict`
    "Board is closed" for a mutation on a closed board. `allow_closed` exempts the four routes
    that must keep working while a board is closed - reopen, board delete, star/unstar and
    "Leave board" (Sections 4.1 and 6.6). Reads are never refused.
    """

    def dependency(request: Request, board_id: PathId, user: CurrentUser, db: Db) -> BoardCtx:
        board = db.get(Board, board_id)
        membership = db.execute(
            select(BoardMember).where(
                BoardMember.board_id == board_id, BoardMember.user_id == user.id
            )
        ).scalar_one_or_none()
        if board is None or membership is None:
            raise NotFound("not_found", "Board not found.")
        ctx = BoardCtx(board=board, member=membership, user=user)
        if not ctx.has_role(min_role):
            raise Forbidden("forbidden", f"This action requires the {min_role.value} role.")
        if board.is_closed and not allow_closed and _is_mutation(request.method):
            raise Conflict("conflict", "Board is closed", {"board_id": board_id})
        return ctx

    return dependency


def _board_id_of(db: Session, statement: Select[tuple[int]], *, missing: str) -> int:
    """The board a child row belongs to, for the factories below (step 4 of Section 6.7.2).

    One statement selecting one column, because the dependency needs the board id and nothing
    else. A row that is not there raises `NotFound` (404 `not_found`) with `missing` as the
    message, exactly as `board_access` answers for a board the caller cannot see, so no child id
    can be enumerated either.
    """
    board_id = db.execute(statement).scalar_one_or_none()
    if board_id is None:
        raise NotFound("not_found", missing)
    return int(board_id)


def list_access(min_role: Role = Role.member) -> Callable[..., BoardCtx]:
    """Build the dependency of a `/api/lists/{list_id}` route (Sections 4.1 and 6.6).

    The list's board is resolved first and then handed to `board_access(min_role)`, so the member,
    role and closed-board rules are checked by the one dependency every `/api/boards/...` route
    uses (CLAUDE.md section 3).
    """
    check = board_access(min_role)

    def dependency(request: Request, list_id: PathId, user: CurrentUser, db: Db) -> BoardCtx:
        board_id = _board_id_of(
            db,
            select(List.board_id).where(List.id == list_id),
            missing="That list does not exist.",
        )
        return check(request=request, board_id=board_id, user=user, db=db)

    return dependency


def card_access(min_role: Role = Role.member) -> Callable[..., BoardCtx]:
    """Build the dependency of a `/api/cards/{card_id}` route (step 4 of Section 6.7.2)."""
    check = board_access(min_role)

    def dependency(request: Request, card_id: PathId, user: CurrentUser, db: Db) -> BoardCtx:
        board_id = _board_id_of(
            db,
            select(Card.board_id).where(Card.id == card_id),
            missing="That card does not exist.",
        )
        return check(request=request, board_id=board_id, user=user, db=db)

    return dependency


def label_access(min_role: Role = Role.member) -> Callable[..., BoardCtx]:
    """Build the dependency of a `/api/labels/{label_id}` route (Section 4.3).

    A label carries its `board_id`, so this is the one factory whose resolve needs no join.
    """
    check = board_access(min_role)

    def dependency(request: Request, label_id: PathId, user: CurrentUser, db: Db) -> BoardCtx:
        board_id = _board_id_of(
            db,
            select(Label.board_id).where(Label.id == label_id),
            missing="That label does not exist.",
        )
        return check(request=request, board_id=board_id, user=user, db=db)

    return dependency


def checklist_access(min_role: Role = Role.member) -> Callable[..., BoardCtx]:
    """Build the dependency of a `/api/checklists/{checklist_id}` route (Section 4.6)."""
    check = board_access(min_role)

    def dependency(request: Request, checklist_id: PathId, user: CurrentUser, db: Db) -> BoardCtx:
        board_id = _board_id_of(
            db,
            select(Card.board_id)
            .join(Checklist, Checklist.card_id == Card.id)
            .where(Checklist.id == checklist_id),
            missing="That checklist does not exist.",
        )
        return check(request=request, board_id=board_id, user=user, db=db)

    return dependency


def item_access(min_role: Role = Role.member) -> Callable[..., BoardCtx]:
    """Build the dependency of a `/api/checklist-items/{item_id}` route (Section 4.6)."""
    check = board_access(min_role)

    def dependency(request: Request, item_id: PathId, user: CurrentUser, db: Db) -> BoardCtx:
        board_id = _board_id_of(
            db,
            select(Card.board_id)
            .join(Checklist, Checklist.card_id == Card.id)
            .join(ChecklistItem, ChecklistItem.checklist_id == Checklist.id)
            .where(ChecklistItem.id == item_id),
            missing="That checklist item does not exist.",
        )
        return check(request=request, board_id=board_id, user=user, db=db)

    return dependency


def attachment_access(min_role: Role = Role.member) -> Callable[..., BoardCtx]:
    """Build the dependency of an `/api/attachments/{attachment_id}` route (Section 4.6)."""
    check = board_access(min_role)

    def dependency(request: Request, attachment_id: PathId, user: CurrentUser, db: Db) -> BoardCtx:
        board_id = _board_id_of(
            db,
            select(Card.board_id)
            .join(Attachment, Attachment.card_id == Card.id)
            .where(Attachment.id == attachment_id),
            missing="That attachment does not exist.",
        )
        return check(request=request, board_id=board_id, user=user, db=db)

    return dependency


def comment_access(min_role: Role = Role.member) -> Callable[..., BoardCtx]:
    """Build the dependency of a `/api/comments/{comment_id}` route (Section 4.6).

    It adds no rule of its own: *which* comment a caller may edit or delete is the author rule
    `services/comments.py` applies, which is why the comment routes ask for `observer` here.
    """
    check = board_access(min_role)

    def dependency(request: Request, comment_id: PathId, user: CurrentUser, db: Db) -> BoardCtx:
        board_id = _board_id_of(
            db,
            select(Card.board_id)
            .join(Comment, Comment.card_id == Card.id)
            .where(Comment.id == comment_id),
            missing="That comment does not exist.",
        )
        return check(request=request, board_id=board_id, user=user, db=db)

    return dependency


def _is_mutation(method: str) -> bool:
    return method.upper() in UNSAFE_METHODS


# --------------------------------------------------------------------------- CSRF


class CsrfHeaderMiddleware:
    """Refuse cookie-authenticated `/api` mutations without `X-Requested-With: fetch` (4.1).

    Pure ASGI, mounted between the rate limiter and the body-size limit (Section 6.4 step 5), so
    the body of a request that is about to be refused is never parsed. Bearer-authenticated
    requests are exempt because a cross-site form cannot set an `Authorization` header, and a
    request carrying no session cookie at all is left to `current_user` to answer with 401.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and self._is_refused(scope):
            forbidden = Forbidden(
                "csrf_header_missing", f"{CSRF_HEADER}: {CSRF_HEADER_VALUE} is required."
            )
            await error_response(forbidden)(scope, receive, send)
            return
        await self.app(scope, receive, send)

    def _is_refused(self, scope: Scope) -> bool:
        if scope.get("method", "GET").upper() not in UNSAFE_METHODS:
            return False
        if not scope.get("path", "").startswith(_API_PREFIX):
            return False
        headers = Headers(scope=scope)
        if headers.get("authorization", "").startswith(_BEARER_PREFIX):
            return False
        if not _has_session_cookie(headers):
            return False
        return headers.get(CSRF_HEADER, "").strip().lower() != CSRF_HEADER_VALUE


def _has_session_cookie(headers: Headers) -> bool:
    """Whether a `kb_session` cookie is present, without parsing values we do not need."""
    cookie_header = headers.get("cookie", "")
    return any(part.strip().startswith(f"{COOKIE_NAME}=") for part in cookie_header.split(";"))
