"""Shared fixtures.

Every test module gets its own freshly migrated SQLite **file** (never `:memory:`, so WAL and the
PRAGMAs behave exactly as in production, Section 6.5.2), and the engine is disposed in teardown
because Windows will not delete a database file while a handle is open.

The `KANBAN_*` environment is set before `kanban` is imported: `kanban.config.settings` and
`kanban.db.engine` are module-level singletons that read it once.

Kan Ban is a single-person install with no account of any kind, so the ladder every API test
builds on is short: `api` (one `TestClient` per module) -> `board_factory` / `board` (boards
created through the real API). The one guard that still decides whether a mutation is allowed to
start is the CSRF header, and it is passed per request as `CSRF_HEADERS` rather than set on the
client once, so the refusal itself stays testable (`test_cards.py`).
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

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from kanban import db as db_module
from kanban import ratelimit
from kanban.access import CSRF_HEADER, CSRF_HEADER_VALUE
from kanban.config import settings
from kanban.main import create_app
from kanban.models import Board

#: The database file and the two WAL sidecars, removed together.
_DB_SUFFIXES = ("", "-wal", "-shm")

#: Every `/api` mutation must carry the CSRF header (Sections 4.1 and 6.6). Read from the module
#: that owns the header rather than spelled a second time here (CLAUDE.md section 3).
CSRF_HEADERS = {CSRF_HEADER: CSRF_HEADER_VALUE}


@contextmanager
def _seed_session() -> Iterator[Session]:
    """Insert fixture rows with the app's own lock discipline.

    Tests normally set up through the public API (CLAUDE.md section 6); the infrastructure tests
    of `test_db.py` and `test_ordering.py` predate the M1 routers and insert their own rows.
    """
    session = db_module.SessionLocal()
    try:
        with db_module.unversioned_write(session):
            yield session
    finally:
        session.close()


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
def api(database: None) -> Iterator[TestClient]:
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
    """Give every test the full token bucket of Section 4.1.

    The bucket is process-wide by design (one process, one limit), so without this a module that
    happened to make six hundred requests would start answering 429 in whichever test ran next.
    """
    ratelimit.reset_all()
    yield
    ratelimit.reset_all()


@pytest.fixture
def board_factory(api: TestClient) -> Callable[..., dict[str, Any]]:
    """Create boards through `POST /api/boards`.

    Fixtures set up through the public API rather than by inserting rows (CLAUDE.md section 6),
    so every board a test works with went through `services.boards.create_board` and carries
    its six labels and (unless told otherwise) default lists.
    """

    def create(name: str = "Fixture board", **body: Any) -> dict[str, Any]:
        response = api.post("/api/boards", json={"name": name, **body}, headers=CSRF_HEADERS)
        assert response.status_code == 201, response.text
        return response.json()

    return create


@pytest.fixture
def board(board_factory: Callable[..., dict[str, Any]]) -> dict[str, Any]:
    """One board: the `BoardSummary` that created it."""
    return board_factory("Sprint 42")


@pytest.fixture(scope="module")
def board_id(database: None) -> int:
    """A board whose `version` and ordered children the infrastructure tests exercise."""
    with _seed_session() as session:
        row = Board(name="Fixture board")
        session.add(row)
        session.flush()
        return row.id
