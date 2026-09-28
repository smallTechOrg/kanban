"""Shared fixtures.

Every test module gets its own freshly migrated SQLite **file** (never `:memory:`, so WAL and the
PRAGMAs behave exactly as in production, Section 6.5.2), and the engine is disposed in teardown
because Windows will not delete a database file while a handle is open.

The `KANBAN_*` environment is set before `kanban` is imported: `kanban.config.settings` and
`kanban.db.engine` are module-level singletons that read it once.

The ladder every API test builds on is `client` (one `TestClient` per module) -> `api` (the same
client with an empty cookie jar) -> `logged_in` (`(TestClient, User)`, signed in as the module's
`registered_user`) -> `board_factory` / `board` (boards created through the real API).
"""

import os
import tempfile
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest

_TMP_ROOT = Path(tempfile.mkdtemp(prefix="kanban-tests-"))
os.environ["KANBAN_ENV"] = "dev"
os.environ["KANBAN_DATA_DIR"] = str(_TMP_ROOT)
os.environ["KANBAN_DB_PATH"] = str(_TMP_ROOT / "kanban.db")
os.environ["KANBAN_SECRET"] = "test-secret-not-a-real-key"

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from kanban import db as db_module
from kanban import ratelimit
from kanban.config import settings
from kanban.main import create_app
from kanban.models import Board, User

#: The database file and the two WAL sidecars, removed together.
_DB_SUFFIXES = ("", "-wal", "-shm")

#: Every cookie-authenticated mutation must carry the CSRF header (Sections 4.1 and 6.6).
CSRF_HEADERS = {"X-Requested-With": "fetch"}

#: The password every fixture account is created with (Section 4.1 allows 8-128 characters).
FIXTURE_PASSWORD = "fixture-password"

#: The account `registered_user` creates once per test module.
FIXTURE_USERNAME = "ada_lovelace"


@contextmanager
def _seed_session() -> Iterator[Session]:
    """Insert fixture rows with the app's own lock discipline.

    Tests normally set up through the public API (CLAUDE.md section 6); the infrastructure tests
    of `test_db.py` and `test_ordering.py` predate the M1 routers and insert their own rows.
    """
    session = db_module.SessionLocal()
    try:
        with db_module.user_write(session):
            yield session
    finally:
        session.close()


def register_payload(username: str, **overrides: Any) -> dict[str, Any]:
    """A `POST /api/auth/register` body for `username`, with any field overridden."""
    body: dict[str, Any] = {
        "email": f"{username}@example.com",
        "username": username,
        "full_name": username.replace("_", " ").title(),
        "password": FIXTURE_PASSWORD,
    }
    return body | overrides


def bearer_headers(token: str) -> dict[str, str]:
    """`Authorization: Bearer <raw token>`: authenticated, and exempt from CSRF (Section 4.1)."""
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def database() -> Iterator[None]:
    """A database file created from scratch by `alembic upgrade head` for this module."""
    db_module.engine.dispose()
    settings.ensure_directories()
    for suffix in _DB_SUFFIXES:
        Path(str(settings.db_path) + suffix).unlink(missing_ok=True)
    db_module.upgrade_to_head()
    yield
    db_module.engine.dispose()


@pytest.fixture(scope="module")
def client(database: None) -> Iterator[TestClient]:
    """A `TestClient` whose context manager runs the real lifespan."""
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def db(database: None) -> Iterator[Session]:
    """A Session shaped like the one `get_db` hands a request."""
    session = db_module.SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture(autouse=True)
def _full_rate_limit_buckets() -> Iterator[None]:
    """Give every test the full token buckets of Section 4.1.

    The buckets are process-wide by design (one process, one limit), so without this the tenth
    login of the whole suite would start answering 429 in whichever test happened to run then.
    """
    ratelimit.reset_all()
    yield
    ratelimit.reset_all()


@pytest.fixture
def api(client: TestClient) -> Iterator[TestClient]:
    """The module's `TestClient` with an empty cookie jar; each test signs itself in."""
    client.cookies.clear()
    yield client
    client.cookies.clear()


@pytest.fixture(scope="module")
def registered_user(client: TestClient) -> dict[str, Any]:
    """One account created through `POST /api/auth/register`: its `UserOut` payload."""
    ratelimit.reset_all()
    response = client.post(
        "/api/auth/register", json=register_payload(FIXTURE_USERNAME), headers=CSRF_HEADERS
    )
    assert response.status_code == 201, response.text
    client.cookies.clear()  # registration signs the caller in; hand back a clean jar
    return response.json()


@pytest.fixture
def logged_in(api: TestClient, registered_user: dict[str, Any]) -> tuple[TestClient, User]:
    """An authenticated client plus the `users` row it is signed in as."""
    response = api.post(
        "/api/auth/login",
        json={"email_or_username": registered_user["username"], "password": FIXTURE_PASSWORD},
        headers=CSRF_HEADERS,
    )
    assert response.status_code == 200, response.text
    return api, _detached_user(registered_user["id"])


@pytest.fixture
def board_factory(logged_in: tuple[TestClient, User]) -> Callable[..., dict[str, Any]]:
    """Create boards through `POST /api/boards` as the logged-in user.

    Fixtures set up through the public API rather than by inserting rows (CLAUDE.md section 6),
    so every board a test works with went through `services.boards.create_board` and carries
    its seeded admin membership, six labels and (unless told otherwise) default lists.
    """
    api, _user = logged_in

    def create(name: str = "Fixture board", **body: Any) -> dict[str, Any]:
        response = api.post("/api/boards", json={"name": name, **body}, headers=CSRF_HEADERS)
        assert response.status_code == 201, response.text
        return response.json()

    return create


@pytest.fixture
def board(board_factory: Callable[..., dict[str, Any]]) -> dict[str, Any]:
    """One board owned by the logged-in user: the `BoardSummary` that created it."""
    return board_factory("Sprint 42")


@pytest.fixture(scope="module")
def owner_id(database: None) -> int:
    """A user to own the fixture boards of the infrastructure tests."""
    with _seed_session() as session:
        user = User(
            email="owner@example.com",
            username="owner",
            full_name="Test Owner",
            initials="TO",
            password_hash="not-a-real-hash",
        )
        session.add(user)
        session.flush()
        return user.id


@pytest.fixture(scope="module")
def board_id(owner_id: int) -> int:
    """A board whose `version` and ordered children the tests exercise."""
    with _seed_session() as session:
        board = Board(name="Fixture board", owner_id=owner_id)
        session.add(board)
        session.flush()
        return board.id


def _detached_user(user_id: int) -> User:
    """The `users` row, detached with every column loaded.

    A Session held open for the whole test would hold a WAL read snapshot, and the API writes a
    test makes afterwards would be invisible to it (Section 6.5.2), so this one is closed at once.
    """
    session = db_module.SessionLocal()
    try:
        user = session.get(User, user_id)
        assert user is not None
        session.expunge(user)
        return user
    finally:
        session.rollback()
        session.close()
