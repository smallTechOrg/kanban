"""User accounts: registration, credentials, the profile and the directory (Sections 4.2, 6.7).

Every rule behind `/api/auth/*` and `GET /api/users` lives here. Password hashing, sessions and
the cookie belong to `kanban/auth.py`; this module calls into it and never re-implements any of it.
The bootstrap of the `KANBAN_SINGLE_USER=1` `admin` account is **not** here either: Section 3.10
puts both seeding paths in `kanban/seed.py`, whose `bootstrap_admin()` registers it through
`register_user()` so a seeded account and a signed-up one differ in nothing.
"""

from typing import Final

from sqlalchemy import Select, collate, func, or_, select
from sqlalchemy.orm import Session

from kanban import auth
from kanban.config import settings
from kanban.constants import AVATAR_COLORS
from kanban.db import write_tx
from kanban.errors import BadRequest, Conflict, Forbidden, NotFound, Unauthenticated
from kanban.models import User

#: `GET /api/users` page size (Section 4.2); `WorkspaceMembersPage` asks for the maximum.
DEFAULT_USER_LIMIT: Final[int] = 20
MAX_USER_LIMIT: Final[int] = 500

#: A search term must be this long before it is worth a `LIKE '%q%'` over every user.
MIN_QUERY_LENGTH: Final[int] = 2

#: How `initials` is derived: the first letter of each of the first two words of `full_name`.
_INITIAL_WORDS: Final[int] = 2

#: `\` escapes the LIKE wildcards, so a user typing `%` searches for a literal per cent sign.
_LIKE_ESCAPE: Final[str] = "\\"


def register_user(
    db: Session,
    *,
    email: str,
    username: str,
    full_name: str,
    password: str,
    enforce_signup_lock: bool = False,
) -> User:
    """Create one account and return it (Section 4.2).

    `initials` is the first letter of each of the first two words of `full_name`, upper-cased, and
    `avatar_color` comes round-robin from `constants.AVATAR_COLORS`. Runs in its own `write_tx(db)`
    with no board ids (Section 4.1): BEGIN IMMEDIATE, no version bump, no activity row, no event.
    Raises `Forbidden` (403 `signup_disabled`) when `enforce_signup_lock` is set,
    `KANBAN_ALLOW_SIGNUP=0` and at least one user exists - only the public signup route sets it, so
    `kanban create-user` and `seed.py` deliberately bypass the lock - and `Conflict` (409) when the
    email or the username is already registered.
    """
    with write_tx(db):
        if enforce_signup_lock and not settings.allow_signup and _any_user_exists(db):
            raise Forbidden("signup_disabled", "Registration is disabled on this server.")
        _reject_duplicates(db, email=email, username=username)
        user = User(
            email=email,
            username=username,
            full_name=full_name,
            initials=initials_of(full_name, fallback=username),
            avatar_color=_next_avatar_color(db),
            password_hash=auth.hash_password(password),
        )
        db.add(user)
        db.flush()
    return user


def authenticate(db: Session, *, email_or_username: str, password: str) -> User:
    """Return the user those credentials belong to (Section 4.2).

    Raises `Unauthenticated` (401) for an unknown login and for a wrong password alike, with the
    same message either way so the response cannot be used to enumerate accounts. Re-hashes the
    stored digest in one short `write_tx` when `check_needs_rehash` says the argon2 parameters have
    moved on since it was written (Section 6.6).
    """
    user = _find_by_login(db, email_or_username)
    if user is None or not auth.verify_password(user.password_hash, password):
        raise Unauthenticated("unauthenticated", "Incorrect email or password.")
    if auth.needs_rehash(user.password_hash):
        with write_tx(db):
            user.password_hash = auth.hash_password(password)
    return user


def update_profile(
    db: Session,
    user: User,
    *,
    current_session_id: int | None = None,
    full_name: str | None = None,
    avatar_color: str | None = None,
    password: str | None = None,
    current_password: str | None = None,
) -> User:
    """Apply a `PATCH /api/auth/me` body to the caller's own account (Section 4.2).

    An absent field is untouched (Section 4.1); `full_name` also refreshes `initials`, which is
    derived from it. A new `password` requires a matching `current_password` - `BadRequest` (400)
    otherwise - and revokes every other session of the user, so other devices are logged out while
    the caller's own session and cookie stay valid (Section 6.6).
    """
    if password is not None and not (
        current_password and auth.verify_password(user.password_hash, current_password)
    ):
        raise BadRequest("bad_request", "current_password does not match.")
    if full_name is None and avatar_color is None and password is None:
        return user
    with write_tx(db) as ctx:
        if full_name is not None:
            user.full_name = full_name
            user.initials = initials_of(full_name, fallback=user.username)
        if avatar_color is not None:
            user.avatar_color = avatar_color
        if password is not None:
            user.password_hash = auth.hash_password(password)
            auth.revoke_other_sessions(ctx, user.id, keep_session_id=current_session_id)
    return user


def list_users(db: Session, *, q: str | None = None, limit: int = DEFAULT_USER_LIMIT) -> list[User]:
    """The workspace directory behind `GET /api/users` (Section 4.2).

    With `q`, the users whose `username` or `full_name` contains it case-insensitively; without it,
    every registered user. Ordered by `full_name COLLATE NOCASE, username` either way. Raises
    nothing: the router validates `q` and `limit`.
    """
    statement: Select[tuple[User]] = (
        select(User).order_by(collate(User.full_name, "NOCASE"), User.username).limit(limit)
    )
    if q:
        pattern = f"%{_escape_like(q)}%"
        statement = statement.where(
            or_(
                User.username.like(pattern, escape=_LIKE_ESCAPE),
                collate(User.full_name, "NOCASE").like(pattern, escape=_LIKE_ESCAPE),
            )
        )
    return list(db.execute(statement).scalars())


def get_by_username(db: Session, username: str) -> User:
    """The account named `username`, for `POST /api/auth/dev-login`. Raises `NotFound` (404)."""
    user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
    if user is None:
        raise NotFound("not_found", f"No user named {username!r}.")
    return user


def initials_of(full_name: str, *, fallback: str) -> str:
    """The first letter of each of the first two words of `full_name`, upper-cased (Section 4.2).

    A name with no letters at all (possible from `kanban create-user`, whose `--name` is optional)
    falls back to the first two characters of `fallback`, because `users.initials` is NOT NULL and
    every avatar needs something to draw.
    """
    words = full_name.split()
    initials = "".join(word[0] for word in words[:_INITIAL_WORDS])
    return (initials or fallback[:_INITIAL_WORDS]).upper()


def _any_user_exists(db: Session) -> bool:
    """Whether this install has at least one account, which is what locks signup (Section 6.6)."""
    return db.execute(select(func.count()).select_from(User)).scalar_one() > 0


def _next_avatar_color(db: Session) -> str:
    """The next colour of the Section 4.2 round robin, keyed by how many accounts exist."""
    count = db.execute(select(func.count()).select_from(User)).scalar_one()
    return AVATAR_COLORS[count % len(AVATAR_COLORS)]


def _reject_duplicates(db: Session, *, email: str, username: str) -> None:
    """409 `conflict` before the INSERT, so the message names the field that clashed.

    The UNIQUE constraints are still the authority: a racing writer is caught by the
    `IntegrityError` handler, which answers with the same 409 (Section 6.10).
    """
    existing = (
        db.execute(select(User).where(or_(User.email == email, User.username == username)))
        .scalars()
        .first()
    )
    if existing is None:
        return
    field = "email" if existing.email.lower() == email.lower() else "username"
    raise Conflict("conflict", f"That {field} is already registered.", {"field": field})


def _find_by_login(db: Session, email_or_username: str) -> User | None:
    """One SELECT over both credentials; `users.email` and `users.username` are NOCASE columns."""
    return (
        db.execute(
            select(User).where(
                or_(User.email == email_or_username, User.username == email_or_username)
            )
        )
        .scalars()
        .first()
    )


def _escape_like(term: str) -> str:
    """Escape the LIKE wildcards so a search term is matched literally."""
    for character in (_LIKE_ESCAPE, "%", "_"):
        term = term.replace(character, _LIKE_ESCAPE + character)
    return term
