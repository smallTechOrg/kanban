"""`alembic upgrade head` on a fresh file produces the Section 3.4 schema."""

from sqlalchemy import inspect, text

from kanban.db import engine
from kanban.models import Base

#: Section 3.4, plus the FTS5 virtual table that only the migration can create.
EXPECTED_TABLES = frozenset(
    {
        "users",
        "sessions",
        "board_backgrounds",
        "boards",
        "board_members",
        "board_stars",
        "board_views",
        "lists",
        "cards",
        "labels",
        "card_labels",
        "card_members",
        "card_watchers",
        "checklists",
        "checklist_items",
        "comments",
        "attachments",
        "activities",
        "cards_fts",
    }
)

FTS_TRIGGERS = ("cards_ai", "cards_ad", "cards_au")


def test_every_table_exists(database: None) -> None:
    tables = set(inspect(engine).get_table_names())

    assert tables >= EXPECTED_TABLES


def test_models_and_migration_declare_the_same_tables(database: None) -> None:
    tables = set(inspect(engine).get_table_names())

    assert tables >= set(Base.metadata.tables)


def test_full_text_search_is_wired_up(database: None) -> None:
    with engine.connect() as conn:
        triggers = set(
            conn.execute(text("SELECT name FROM sqlite_master WHERE type = 'trigger'")).scalars()
        )

    assert triggers >= set(FTS_TRIGGERS)


def test_head_revision_is_recorded(database: None) -> None:
    with engine.connect() as conn:
        revision = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()

    assert revision == "0001_initial"
