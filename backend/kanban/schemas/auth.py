"""Request and response models for `/api/auth/*` and `/api/users` (Section 4.2).

`UserOut` carries `email` and is therefore returned **only** by the `/api/auth/*` routes, which
always describe the caller themselves. Everywhere a user is embedded for other people to see the
API returns `PublicUserOut` (declared once in `schemas/common.py`), which has no email at all.
"""

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from kanban.schemas.common import PublicUserOut

#: Section 4.1: every request body forbids unknown keys and strips surrounding whitespace.
_BODY = ConfigDict(extra="forbid", str_strip_whitespace=True)

#: Section 4.1 validation table.
USERNAME_PATTERN = r"^[a-z0-9_]{3,32}$"
PASSWORD_MIN = 8
PASSWORD_MAX = 128

#: `full_name` has no limit of its own in Section 4.1; it borrows the generic `name` bound.
NAME_MAX = 512

#: An `#RRGGBB` literal, as `POST /api/boards` requires for a colour background (Section 4.3).
HEX_COLOR_PATTERN = r"^#[0-9A-Fa-f]{6}$"


class RegisterIn(BaseModel):
    """`POST /api/auth/register` (Section 4.2)."""

    model_config = _BODY

    email: EmailStr
    username: str = Field(pattern=USERNAME_PATTERN)
    full_name: str = Field(min_length=1, max_length=NAME_MAX)
    password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)


class LoginIn(BaseModel):
    """`POST /api/auth/login`: one field for either credential (Section 4.2)."""

    model_config = _BODY

    email_or_username: str = Field(min_length=1, max_length=NAME_MAX)
    password: str = Field(min_length=1, max_length=PASSWORD_MAX)


class DevLoginIn(BaseModel):
    """`POST /api/auth/dev-login`: Playwright's password-free login, mounted only in dev."""

    model_config = _BODY

    username: str = Field(pattern=USERNAME_PATTERN)


class ProfileUpdateIn(BaseModel):
    """`PATCH /api/auth/me`, sent by `ProfileModal` (Sections 2.1.1 and 4.2).

    Every field is optional and `exclude_unset=True` decides what is touched; `password` needs a
    matching `current_password`, which `services/users.py` enforces with 400 `bad_request`.
    """

    model_config = _BODY

    full_name: str | None = Field(default=None, min_length=1, max_length=NAME_MAX)
    avatar_color: str | None = Field(default=None, pattern=HEX_COLOR_PATTERN)
    password: str | None = Field(default=None, min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)
    current_password: str | None = Field(default=None, max_length=PASSWORD_MAX)


class UserOut(BaseModel):
    """The caller's own account. The only shape that carries an email (Section 4.2)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    username: str
    full_name: str
    initials: str
    avatar_color: str
    created_at: str


class SessionOut(BaseModel):
    """`POST /api/auth/login`: the caller plus the raw token for bearer use (Section 4.2).

    The cookie is set on the same response and the SPA ignores `token`; scripts and curl use it as
    `Authorization: Bearer <token>`, which is exempt from the CSRF header (Section 4.1).
    """

    user: UserOut
    token: str


class UserListOut(BaseModel):
    """`GET /api/users`: the workspace directory, never another user's email (Section 4.2)."""

    items: list[PublicUserOut]
