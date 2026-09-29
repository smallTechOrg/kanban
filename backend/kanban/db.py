"""Engine, session and the write transaction (Sections 3.3 and 6.5).

`write_tx()` is the only way a mutation touches the database (CLAUDE.md section 3). The lock
discipline it implements is the reason "readers never block" holds literally:

* the `connect` listener applies the PRAGMAs and sets `dbapi_conn.isolation_level = None`, so
  pysqlite stops emitting its own implicit deferred `BEGIN`;
* the `begin` listener issues `BEGIN IMMEDIATE` only for a connection procured with
  `execution_options(write=True)` - which only `write_tx()` and `unversioned_write()` do - and
  a plain deferred `BEGIN` (a WAL read snapshot) for everything else.
"""

import logging
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from sqlalchemy import Connection, create_engine, event, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from kanban.config import settings
from kanban.errors import Busy, is_locked_error
from kanban.events import install_session_listeners
from kanban.models import utcnow_iso

logger = logging.getLogger(__name__)

#: `backend/`, from which the Alembic configuration is addressed absolutely (Section 6.3).
BACKEND_ROOT: Path = Path(__file__).resolve().parent.parent

engine = create_engine(
    settings.db_url,
    connect_args={"check_same_thread": False, "timeout": 5},
    poolclass=QueuePool,
    pool_size=5,
    max_overflow=5,
)


@event.listens_for(engine, "connect")
def _set_pragmas(dbapi_conn: Any, _record: Any) -> None:
    """SQLite PRAGMAs are per connection; `journal_mode=WAL` persists in the file (Section 3.3)."""
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode = WAL")
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.execute("PRAGMA busy_timeout = 5000")
    cursor.execute("PRAGMA synchronous = NORMAL")
    cursor.execute("PRAGMA temp_store = MEMORY")
    cursor.close()
    # SQLAlchemy's documented pysqlite recipe: stop the DBAPI from emitting its own implicit
    # deferred BEGIN so that the `begin` listener below owns transaction start.
    dbapi_conn.isolation_level = None


@event.listens_for(engine, "begin")
def _begin(conn: Connection) -> None:
    """Writers take the RESERVED lock up front; readers open a snapshot that blocks nobody."""
    options = conn.get_execution_options()
    # SQLAlchemy still emits `begin` for an AUTOCOMMIT connection, so a literal BEGIN here would
    # open the very transaction AUTOCOMMIT was asked for to avoid: statements that SQLite forbids
    # inside one (`kanban backup`'s VACUUM INTO) would then fail.
    if options.get("isolation_level") == "AUTOCOMMIT":
        return
    if options.get("write"):
        conn.exec_driver_sql("BEGIN IMMEDIATE")
    else:
        conn.exec_driver_sql("BEGIN")


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

# The publish half of a write: `events.py` turns the `activities` rows of a flush into `EventOut`
# payloads and hands them to the bus after the COMMIT that made them real (Section 4.8). It is
# installed here, beside the session factory it listens to, and nowhere else.
install_session_listeners()


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one Session per request, rolled back and closed when it ends."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.rollback()  # ends the deferred read snapshot autobegun by the request's SELECTs
        db.close()


@dataclass
class WriteCtx:
    """What a service writes through: the session and the boards whose version is being bumped.

    It carries no event queue: an event is derived from the `activities` row that describes the
    change, by the `Session` listeners `events.py` installs above, so a service publishes nothing
    by hand and cannot forget to (CLAUDE.md section 8).
    """

    db: Session
    #: Every board whose `version` this write bumps: one normally, two for a cross-board move.
    board_ids: list[int]
    #: board_id -> `boards.version` + 1, read under the write lock.
    versions: dict[int, int] = field(default_factory=dict)

    @property
    def board_id(self) -> int:
        return self.board_ids[0]

    @property
    def board_version(self) -> int:
        return self.versions[self.board_ids[0]]


@contextmanager
def write_tx(db: Session, board_ids: Iterable[int] = ()) -> Iterator[WriteCtx]:
    """Open the one write transaction a mutating request is allowed (Sections 3.3 and 6.5.2).

    The request's dependencies have already autobegun a deferred read snapshot on this Session,
    so this ends it with `db.rollback()` before `db.begin()` opens the write transaction with
    `BEGIN IMMEDIATE`. Services may use ORM `add()`: the flush happens before the version bump.
    Raises `Busy` (503 `database_busy`) when the write lock cannot be taken within
    `busy_timeout`, and `RuntimeError` on a nested call, which is a programming error.
    """
    if db.info.get("write_tx"):
        raise RuntimeError("nested write_tx is a programming error")
    db.rollback()  # the dependencies' read snapshot ends here; nothing is open now
    db.info["write_tx"] = True
    ctx = WriteCtx(db=db, board_ids=list(board_ids))
    try:
        with db.begin():  # COMMIT on exit, ROLLBACK on exception
            # Procuring the connection with the flag is what makes the `begin` listener emit
            # BEGIN IMMEDIATE, so two concurrent movers serialise instead of failing at commit.
            db.connection(execution_options={"write": True})
            for board_id in ctx.board_ids:
                ctx.versions[board_id] = db.execute(
                    text("SELECT version + 1 FROM boards WHERE id = :id"), {"id": board_id}
                ).scalar_one()
            yield ctx
            db.flush()  # ORM-added rows reach SQLite before the version bump
            for board_id, version in ctx.versions.items():
                db.execute(
                    text("UPDATE boards SET version = :v, updated_at = :now WHERE id = :id"),
                    {"v": version, "now": utcnow_iso(), "id": board_id},
                )
    except OperationalError as exc:
        if is_locked_error(exc):
            raise Busy("database_busy", "The board is busy, please retry.") from exc
        raise
    finally:
        db.info.pop("write_tx", None)


@contextmanager
def unversioned_write(db: Session) -> Iterator[None]:
    """The writes that bypass `write_tx` (Section 4.1).

    The `board_views` upsert and the star toggle: the same lock discipline (end the read snapshot,
    BEGIN IMMEDIATE, one statement, COMMIT) with no version bump, no activity row and no event.
    Neither changes anything the board document renders, so bumping the version would make every
    open tab refetch for a row nothing displays. Never call it with a `write_tx` open.
    """
    db.rollback()
    with db.begin():
        db.connection(execution_options={"write": True})
        yield


def alembic_config() -> Config:
    """The Alembic configuration, addressed absolutely so it works from any cwd (Section 6.3)."""
    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    # ConfigParser treats "%" as interpolation, so escape it before handing over a path.
    cfg.set_main_option("sqlalchemy.url", settings.db_url.replace("%", "%%"))
    return cfg


def upgrade_to_head() -> None:
    """Apply every pending migration. The lifespan and `kanban migrate` share this one path."""
    logger.info("Applying migrations to %s", settings.db_path)
    command.upgrade(alembic_config(), "head")
