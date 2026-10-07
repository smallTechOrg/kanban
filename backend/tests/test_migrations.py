"""`alembic upgrade head` on a fresh file produces the Section 3.4 schema."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

from sqlalchemy import inspect, text

from kanban.constants import BOARD_COLORS
from kanban.db import engine
from kanban.models import Base

#: Section 3.4, plus the FTS5 virtual table that only the migration can create.
EXPECTED_TABLES = frozenset(
    {
        "board_backgrounds",
        "boards",
        "lists",
        "cards",
        "labels",
        "card_labels",
        "card_items",
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

    assert revision == "0003_my_day_palette"


def test_the_palette_migration_lands_every_board_on_a_current_swatch() -> None:
    """`0003` repaints the old backgrounds, and onto colours the picker can still offer."""
    spec = spec_from_file_location(
        "migration_0003",
        Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0003_my_day_palette.py",
    )
    assert spec is not None and spec.loader is not None
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    palette: dict[str, str] = module.PALETTE

    assert len(palette) == len(BOARD_COLORS)
    # Every board lands on a swatch the picker still shows, and on a different one each time,
    # so the downgrade can put it back.
    assert set(palette.values()) <= set(BOARD_COLORS.values())
    assert len(set(palette.values())) == len(palette)
    # Nothing is repainted twice: no old colour is also a new one.
    assert set(palette).isdisjoint(BOARD_COLORS.values())
