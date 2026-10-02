"""The connection settings and the write transaction (Sections 3.3 and 6.5)."""

from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from kanban.db import engine, write_tx


def _board_version(db: Session, board_id: int) -> int:
    return db.execute(
        text("SELECT version FROM boards WHERE id = :id"), {"id": board_id}
    ).scalar_one()


def test_connect_listener_applies_the_pragmas(database: None) -> None:
    with engine.connect() as conn:
        assert conn.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        assert conn.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
        assert conn.exec_driver_sql("PRAGMA busy_timeout").scalar() == 5000


def test_autocommit_runs_statements_forbidden_inside_a_transaction(
    database: None, tmp_path: Path
) -> None:
    """`kanban backup` asks for AUTOCOMMIT so its VACUUM INTO is not wrapped in a transaction.

    SQLAlchemy emits `begin` for an AUTOCOMMIT connection too, so the listener has to stand down
    rather than issue a literal BEGIN - which SQLite would reject the VACUUM against.
    """
    target = tmp_path / "backup.db"

    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.exec_driver_sql("VACUUM INTO ?", (str(target),))

    assert target.is_file()


def test_write_tx_bumps_the_board_version_once(db: Session, board_id: int) -> None:
    before = _board_version(db, board_id)

    with write_tx(db, [board_id]) as ctx:
        assert ctx.board_id == board_id
        assert ctx.board_version == before + 1

    assert _board_version(db, board_id) == before + 1


def test_write_tx_rejects_nesting(db: Session, board_id: int) -> None:
    before = _board_version(db, board_id)

    with (
        pytest.raises(RuntimeError, match="nested write_tx"),
        write_tx(db, [board_id]),
        write_tx(db, [board_id]),
    ):
        pass  # pragma: no cover - the inner context manager never opens

    assert _board_version(db, board_id) == before
    assert "write_tx" not in db.info


def test_write_tx_rolls_back_on_failure(db: Session, board_id: int) -> None:
    before = _board_version(db, board_id)

    with pytest.raises(ValueError, match="service failed"), write_tx(db, [board_id]):
        raise ValueError("service failed")

    assert _board_version(db, board_id) == before
