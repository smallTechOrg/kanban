"""`/api/auth/*` and `/api/users` - registration, sessions, CSRF, the rate limit and the slide.

Everything is driven through the public API (CLAUDE.md section 6). Two exceptions, both because
no endpoint exposes what is being asserted: the session slide is read from the `sessions` row,
and the clock the slide compares against is shifted with `monkeypatch` rather than slept through.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kanban import auth, ratelimit
from kanban.config import settings
from kanban.constants import AVATAR_COLORS
from kanban.models import UserSession
from tests.conftest import CSRF_HEADERS, FIXTURE_PASSWORD, bearer_headers, register_payload

#: `UserOut` is the only shape that carries an email, and it carries nothing else (Section 4.2).
USER_OUT_FIELDS = {
    "id",
    "email",
    "username",
    "full_name",
    "initials",
    "avatar_color",
    "created_at",
}

#: `PublicUserOut`: what other people are allowed to see (Section 4.2).
PUBLIC_USER_FIELDS = {"id", "username", "full_name", "initials", "avatar_color"}

NEW_PASSWORD = "an-even-longer-password"


def _login(
    api: TestClient, account: dict[str, Any], *, password: str = FIXTURE_PASSWORD
) -> dict[str, Any]:
    """Sign `api` in as `account`; the client keeps the `kb_session` cookie afterwards."""
    response = api.post(
        "/api/auth/login",
        json={"email_or_username": account["username"], "password": password},
        headers=CSRF_HEADERS,
    )
    assert response.status_code == 200, response.text
    return response.json()


def _register_elsewhere(api: TestClient, username: str) -> dict[str, Any]:
    """Register another account on a client of its own, so `api` keeps its own session."""
    other = TestClient(api.app)
    response = other.post(
        "/api/auth/register", json=register_payload(username), headers=CSRF_HEADERS
    )
    assert response.status_code == 201, response.text
    return response.json()


def _signed_in_as_a_new_account(api: TestClient, username: str) -> dict[str, Any]:
    """A brand new account with `api` signed in as it, for the tests that mutate their user."""
    account = _register_elsewhere(api, username)
    _login(api, account)
    return account


def _sets_the_session_cookie(response: Any) -> bool:
    """Whether the response re-sent `kb_session` with a `Max-Age` (Sections 4.1 and 6.6)."""
    cookies = response.headers.get_list("set-cookie")
    return any(f"{auth.COOKIE_NAME}=" in value and "Max-Age=" in value for value in cookies)


def _session_row(db: Session, token: str) -> UserSession:
    """The `sessions` row behind `token`, read on a fresh snapshot (Section 6.5.2)."""
    db.rollback()  # end the previous read snapshot, so this sees what the API just committed
    return db.execute(
        select(UserSession).where(UserSession.token_hash == auth.hash_token(token))
    ).scalar_one()


def _shift_clock(monkeypatch: pytest.MonkeyPatch, minutes: float) -> None:
    """Move the clock `auth` reads, so the slide is tested without sleeping (Section 6.6)."""
    moment = datetime.now(UTC) + timedelta(minutes=minutes)
    monkeypatch.setattr(auth, "utcnow_iso", lambda: auth.iso(moment))


# --------------------------------------------------------------------------- register


def test_register_returns_the_caller_and_opens_a_session(api: TestClient) -> None:
    response = api.post(
        "/api/auth/register", json=register_payload("grace_hopper"), headers=CSRF_HEADERS
    )

    assert response.status_code == 201, response.text
    payload = response.json()
    assert set(payload) == USER_OUT_FIELDS
    assert payload["username"] == "grace_hopper"
    assert payload["initials"] == "GH"
    assert payload["avatar_color"] in AVATAR_COLORS
    assert _sets_the_session_cookie(response)
    assert api.get("/api/auth/me").json()["id"] == payload["id"]


def test_register_rejects_a_taken_email_with_409(
    api: TestClient, registered_user: dict[str, Any]
) -> None:
    body = register_payload("another_login", email=registered_user["email"])

    response = api.post("/api/auth/register", json=body, headers=CSRF_HEADERS)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"


def test_register_rejects_a_taken_username_with_409(
    api: TestClient, registered_user: dict[str, Any]
) -> None:
    body = register_payload(registered_user["username"], email="unused@example.com")

    response = api.post("/api/auth/register", json=body, headers=CSRF_HEADERS)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"


def test_register_validates_the_username_and_the_password_length(api: TestClient) -> None:
    bad_username = api.post(
        "/api/auth/register", json=register_payload("No Spaces Allowed"), headers=CSRF_HEADERS
    )
    short_password = api.post(
        "/api/auth/register",
        json=register_payload("short_password", password="1234567"),
        headers=CSRF_HEADERS,
    )

    assert bad_username.status_code == 422
    assert bad_username.json()["error"]["code"] == "validation_error"
    assert short_password.status_code == 422


def test_register_is_403_signup_disabled_once_a_user_exists(
    api: TestClient, registered_user: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "allow_signup", False)

    response = api.post(
        "/api/auth/register", json=register_payload("too_late"), headers=CSRF_HEADERS
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "signup_disabled"


# --------------------------------------------------------------------------- login and logout


def test_login_works_with_the_username_or_the_email(
    api: TestClient, registered_user: dict[str, Any]
) -> None:
    by_username = _login(api, registered_user)
    api.cookies.clear()
    by_email = api.post(
        "/api/auth/login",
        json={"email_or_username": registered_user["email"], "password": FIXTURE_PASSWORD},
        headers=CSRF_HEADERS,
    )

    assert by_username["user"]["id"] == registered_user["id"]
    assert by_username["token"]
    assert by_email.status_code == 200
    assert by_email.json()["user"]["id"] == registered_user["id"]


def test_login_with_a_wrong_password_is_401(
    api: TestClient, registered_user: dict[str, Any]
) -> None:
    response = api.post(
        "/api/auth/login",
        json={"email_or_username": registered_user["username"], "password": "not-the-password"},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"


def test_login_with_an_unknown_login_is_401(api: TestClient) -> None:
    response = api.post(
        "/api/auth/login",
        json={"email_or_username": "nobody_here", "password": FIXTURE_PASSWORD},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 401


def test_me_without_a_session_is_401(api: TestClient) -> None:
    response = api.get("/api/auth/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"


def test_a_tampered_cookie_counts_as_no_cookie(api: TestClient) -> None:
    api.cookies.set(auth.COOKIE_NAME, "not-a-signed-token")

    response = api.get("/api/auth/me")

    assert response.status_code == 401


def test_logout_clears_the_cookie_and_the_session_row(
    api: TestClient, registered_user: dict[str, Any], db: Session
) -> None:
    token = _login(api, registered_user)["token"]

    response = api.post("/api/auth/logout", headers=CSRF_HEADERS)

    assert response.status_code == 204
    assert "Max-Age=0" in "".join(response.headers.get_list("set-cookie"))
    db.rollback()
    assert (
        db.execute(
            select(UserSession).where(UserSession.token_hash == auth.hash_token(token))
        ).scalar_one_or_none()
        is None
    )
    assert api.get("/api/auth/me", headers=bearer_headers(token)).status_code == 401


def test_the_bearer_token_authenticates_a_script(
    api: TestClient, registered_user: dict[str, Any]
) -> None:
    token = _login(api, registered_user)["token"]
    api.cookies.clear()

    response = api.get("/api/auth/me", headers=bearer_headers(token))

    assert response.status_code == 200
    assert response.json()["id"] == registered_user["id"]


# --------------------------------------------------------------------------- CSRF


def test_a_cookie_authenticated_mutation_needs_the_csrf_header(
    logged_in: tuple[TestClient, Any],
) -> None:
    api, _user = logged_in

    response = api.post("/api/auth/logout")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_header_missing"


def test_a_bearer_authenticated_mutation_is_csrf_exempt(
    api: TestClient, registered_user: dict[str, Any]
) -> None:
    token = _login(api, registered_user)["token"]
    api.cookies.clear()

    response = api.post("/api/auth/logout", headers=bearer_headers(token))

    assert response.status_code == 204


# --------------------------------------------------------------------------- rate limit


def test_the_login_bucket_answers_429_with_a_retry_after(
    api: TestClient, registered_user: dict[str, Any]
) -> None:
    body = {"email_or_username": registered_user["username"], "password": "not-the-password"}
    ratelimit.reset_all()  # the fixture above may have spent a token registering

    refused = [
        api.post("/api/auth/login", json=body, headers=CSRF_HEADERS).status_code
        for _ in range(ratelimit.login_limiter.capacity)
    ]
    limited = api.post("/api/auth/login", json=body, headers=CSRF_HEADERS)

    assert refused == [401] * ratelimit.login_limiter.capacity
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "rate_limited"
    assert int(limited.headers["Retry-After"]) >= 1


# --------------------------------------------------------------------------- the session slide


def test_a_request_eleven_minutes_later_slides_the_session(
    api: TestClient, registered_user: dict[str, Any], db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = _login(api, registered_user)["token"]
    before = _session_row(db, token).expires_at

    _shift_clock(monkeypatch, 11)
    response = api.get("/api/auth/me")

    assert response.status_code == 200
    assert _session_row(db, token).expires_at > before
    assert _sets_the_session_cookie(response)


def test_a_request_one_minute_later_slides_nothing(
    api: TestClient, registered_user: dict[str, Any], db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = _login(api, registered_user)["token"]
    before = _session_row(db, token).expires_at

    _shift_clock(monkeypatch, 1)
    response = api.get("/api/auth/me")

    assert response.status_code == 200
    assert _session_row(db, token).expires_at == before
    assert not _sets_the_session_cookie(response)


def test_an_expired_session_is_401(
    api: TestClient, registered_user: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    _login(api, registered_user)

    _shift_clock(monkeypatch, settings.session_days * 24 * 60 + 1)

    assert api.get("/api/auth/me").status_code == 401


# --------------------------------------------------------------------------- the profile


def test_updating_the_profile_renames_the_caller_and_its_initials(api: TestClient) -> None:
    _signed_in_as_a_new_account(api, "edsger_dijkstra")

    response = api.patch(
        "/api/auth/me",
        json={"full_name": "Edsger Wybe Dijkstra", "avatar_color": AVATAR_COLORS[3]},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["full_name"] == "Edsger Wybe Dijkstra"
    assert payload["initials"] == "EW"
    assert payload["avatar_color"] == AVATAR_COLORS[3]


def test_changing_the_password_without_the_current_one_is_400(api: TestClient) -> None:
    _signed_in_as_a_new_account(api, "barbara_liskov")

    missing = api.patch("/api/auth/me", json={"password": NEW_PASSWORD}, headers=CSRF_HEADERS)
    wrong = api.patch(
        "/api/auth/me",
        json={"password": NEW_PASSWORD, "current_password": "not-the-password"},
        headers=CSRF_HEADERS,
    )

    assert missing.status_code == 400
    assert missing.json()["error"]["code"] == "bad_request"
    assert wrong.status_code == 400


def test_changing_the_password_revokes_the_other_sessions(api: TestClient) -> None:
    account = _signed_in_as_a_new_account(api, "alan_kay")
    elsewhere = TestClient(api.app)
    _login(elsewhere, account)

    changed = api.patch(
        "/api/auth/me",
        json={"password": NEW_PASSWORD, "current_password": FIXTURE_PASSWORD},
        headers=CSRF_HEADERS,
    )

    assert changed.status_code == 200, changed.text
    assert api.get("/api/auth/me").status_code == 200  # the caller's own session survives
    assert elsewhere.get("/api/auth/me").status_code == 401
    api.cookies.clear()
    assert _login(api, account, password=NEW_PASSWORD)["user"]["id"] == account["id"]


# --------------------------------------------------------------------------- GET /api/users


def test_users_lists_public_users_and_never_an_email(
    logged_in: tuple[TestClient, Any], registered_user: dict[str, Any]
) -> None:
    api, _user = logged_in
    other = _register_elsewhere(api, "margaret_hamilton")

    payload = api.get("/api/users", params={"limit": 500}).json()

    usernames = [item["username"] for item in payload["items"]]
    assert registered_user["username"] in usernames
    assert other["username"] in usernames
    for item in payload["items"]:
        assert set(item) == PUBLIC_USER_FIELDS


def test_users_filters_on_q_over_the_username_and_the_full_name(
    logged_in: tuple[TestClient, Any],
) -> None:
    api, _user = logged_in
    _register_elsewhere(api, "katherine_johnson")

    by_username = api.get("/api/users", params={"q": "katherine"}).json()["items"]
    by_full_name = api.get("/api/users", params={"q": "JOHNSON"}).json()["items"]

    assert [item["username"] for item in by_username] == ["katherine_johnson"]
    assert [item["username"] for item in by_full_name] == ["katherine_johnson"]


def test_users_rejects_a_one_character_query_and_a_zero_limit(
    logged_in: tuple[TestClient, Any],
) -> None:
    api, _user = logged_in

    assert api.get("/api/users", params={"q": "a"}).status_code == 422
    assert api.get("/api/users", params={"limit": 0}).status_code == 422
    assert api.get("/api/users", params={"limit": 501}).status_code == 422


def test_users_requires_a_session(api: TestClient) -> None:
    assert api.get("/api/users").status_code == 401


def test_an_empty_profile_patch_changes_nothing(logged_in: tuple[TestClient, Any]) -> None:
    api, user = logged_in

    response = api.patch("/api/auth/me", json={}, headers=CSRF_HEADERS)

    assert response.status_code == 200
    assert response.json()["full_name"] == user.full_name


# --------------------------------------------------------------------------- dev login


def test_dev_login_signs_in_without_a_password(
    api: TestClient, registered_user: dict[str, Any]
) -> None:
    """The route exists because the suite runs with `KANBAN_ENV=dev` (Section 4.2)."""
    response = api.post(
        "/api/auth/dev-login",
        json={"username": registered_user["username"]},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 200, response.text
    assert response.json()["id"] == registered_user["id"]
    assert api.get("/api/auth/me").json()["id"] == registered_user["id"]


def test_dev_login_with_an_unknown_username_is_404(api: TestClient) -> None:
    response = api.post(
        "/api/auth/dev-login", json={"username": "nobody_here"}, headers=CSRF_HEADERS
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
