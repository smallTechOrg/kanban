"""Alembic environment (Section 3.9).

`render_as_batch=True` because SQLite cannot `ALTER` most things in place: batch mode rebuilds
the table instead. Foreign keys are switched off for the duration of a migration so a batch
rebuild can swap a table out without its children cascading away.

The URL comes from `kanban.config.Settings` unless the caller set one on the Config (the lifespan
and `kanban migrate` do), so `alembic upgrade head` behaves the same from any working directory.
"""

from typing import Any

from alembic import context
from sqlalchemy import engine_from_config, event, pool

from kanban.config import settings
from kanban.models import Base

config = context.config
target_metadata = Base.metadata


def _database_url() -> str:
    configured = config.get_main_option("sqlalchemy.url", None)
    return configured or settings.db_url


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of running it (`alembic upgrade head --sql`)."""
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run the migrations against a live connection."""
    config.set_main_option("sqlalchemy.url", _database_url().replace("%", "%%"))
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    @event.listens_for(connectable, "connect")
    def _disable_foreign_keys(dbapi_conn: Any, _record: Any) -> None:
        """Switch the constraints off for the migration, the way `kanban.db` applies its PRAGMAs.

        It has to happen on the raw DBAPI connection rather than through the `Connection`:
        any statement emitted before `context.configure()` autobegins a SQLAlchemy transaction,
        which Alembic reads as externally owned (`_in_external_transaction`) and therefore never
        commits - leaving the DDL applied but `alembic_version` empty.
        """
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys = OFF")
        cursor.close()

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()
    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
