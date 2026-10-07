"""personal manager: drop stars, views, covers, templates, attachments; items move onto cards

Revision ID: 0002_personal_manager
Revises: 0001_initial
Create Date: 2026-10-01

My Day stopped being a Trello clone and became a personal manager, so five concepts leave the
schema in one change (Section 1.2 of docs/PLANNING.md):

* `board_stars` and `board_views` - the home page is one flat list of boards, so nothing stars a
  board and nothing records that one was looked at.
* `attachments`, and with it `cards.cover_type` / `cover_value` / `cover_size` - a card carries no
  files and no cover band. `board_backgrounds` is untouched: a board still has a background.
* `cards.is_template` - there are no card templates.
* `checklists` - a card's items hang off the card itself. `checklist_items` becomes `card_items`,
  keyed on `card_id`, and every surviving item is folded onto its card in the order it was read
  on screen: checklists by `position`, items by `position` inside each. Positions are renumbered
  to `ordering.STEP * rank`, which is what `renumber()` would have written.

`cards` is rebuilt by hand rather than through `op.batch_alter_table` because SQLAlchemy's SQLite
dialect does not reflect CHECK constraints: batch mode would copy the table without them and
silently drop `ck_cards_title_length` along with the two cover checks it is meant to remove. The
rebuild therefore spells the target DDL out, and - as `0001_initial`'s docstring requires - it
drops the `cards_fts` triggers first and re-creates them with a `'rebuild'` afterwards.

Activity rows are migrated, not deleted, wherever the new vocabulary still has a sentence for
them: the eight `checklist.item_*` types become `item.*`. Rows for a concept that no longer
exists (covers, templates, attachments, cross-board card moves and the checklist container
itself) are removed, because `activity.record()` validates against `ACTIVITY_TYPES` and
`lib/activity.ts` would have no sentence to render. `card.copied` is kept: a card has no copy
endpoint any more, but a *list* copy still copies every card in the column.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_personal_manager"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"

#: `ordering.STEP`. Written out because a migration must keep working when that constant moves.
STEP = 65536.0

#: `checklist.item_*` -> `item.*`; the eight sentences that survive the container's removal.
RENAMED_ACTIVITY_TYPES = {
    "checklist.item_added": "item.added",
    "checklist.item_renamed": "item.renamed",
    "checklist.item_deleted": "item.deleted",
    "checklist.item_checked": "item.checked",
    "checklist.item_unchecked": "item.unchecked",
    "checklist.item_due_set": "item.due_set",
    "checklist.item_due_removed": "item.due_removed",
    "checklist.item_moved": "item.moved",
}

#: Types whose concept is gone; their rows go with it.
DROPPED_ACTIVITY_TYPES = (
    "card.moved_out",
    "card.moved_in",
    "card.cover_changed",
    "card.cover_removed",
    "card.template_set",
    "card.template_unset",
    "checklist.added",
    "checklist.renamed",
    "checklist.deleted",
    "checklist.moved",
    "checklist.item_converted",
    "attachment.added",
    "attachment.renamed",
    "attachment.deleted",
)

CARDS_DDL = f"""
CREATE TABLE cards_new (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL,
    list_id INTEGER NOT NULL,
    short_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '' NOT NULL,
    position FLOAT NOT NULL,
    start_at TEXT,
    due_at TEXT,
    due_complete INTEGER DEFAULT 0 NOT NULL,
    due_reminder_minutes INTEGER,
    is_archived INTEGER DEFAULT 0 NOT NULL,
    client_id TEXT,
    created_at TEXT DEFAULT {NOW} NOT NULL,
    updated_at TEXT DEFAULT {NOW} NOT NULL,
    CONSTRAINT ck_cards_title_length CHECK (length(title) BETWEEN 1 AND 16384),
    CONSTRAINT ck_cards_due_complete CHECK (due_complete IN (0, 1)),
    CONSTRAINT ck_cards_is_archived CHECK (is_archived IN (0, 1)),
    UNIQUE (board_id, short_id),
    FOREIGN KEY(board_id) REFERENCES boards (id) ON DELETE CASCADE,
    FOREIGN KEY(list_id) REFERENCES lists (id) ON DELETE CASCADE
)
"""

CARD_COLUMNS = (
    "id, board_id, list_id, short_id, title, description, position, start_at, due_at, "
    "due_complete, due_reminder_minutes, is_archived, client_id, created_at, updated_at"
)

CARD_INDEXES = (
    ("ix_cards_list_archived_position", ("list_id", "is_archived", "position")),
    ("ix_cards_board_archived", ("board_id", "is_archived")),
    ("ix_cards_due_at", ("due_at",)),
)


def upgrade() -> None:
    _drop_full_text_search()
    _fold_items_onto_cards()
    _rebuild_cards()
    op.drop_table("attachments")
    op.drop_table("board_views")
    op.drop_table("board_stars")
    _migrate_activities()
    _create_full_text_search()


def downgrade() -> None:
    """Structural only: the dropped rows and the uploaded files cannot come back."""
    _drop_full_text_search()
    _restore_checklists()
    _restore_cards()
    _restore_stars_and_views()
    _restore_attachments()
    for old, new in RENAMED_ACTIVITY_TYPES.items():
        op.execute(
            sa.text("UPDATE activities SET type = :old WHERE type = :new").bindparams(
                old=old, new=new
            )
        )
    _create_full_text_search()


# =========================================================== card items


def _fold_items_onto_cards() -> None:
    """`checklist_items` -> `card_items`, every item keyed on its card and renumbered in order."""
    op.create_table(
        "card_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("position", sa.Float(), nullable=False),
        sa.Column("is_checked", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("checked_at", sa.Text(), nullable=True),
        sa.Column("due_at", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Text(), server_default=sa.text(NOW), nullable=False),
        sa.Column("updated_at", sa.Text(), server_default=sa.text(NOW), nullable=False),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 16384", name="ck_card_items_name_length"),
        sa.CheckConstraint("is_checked IN (0, 1)", name="ck_card_items_is_checked"),
        sa.ForeignKeyConstraint(["card_id"], ["cards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_card_items_card_position", "card_items", ["card_id", "position"])
    op.execute(
        f"""
        INSERT INTO card_items
              (id, card_id, name, position, is_checked, checked_at, due_at, created_at, updated_at)
        SELECT i.id,
               c.card_id,
               i.name,
               {STEP} * ROW_NUMBER() OVER (
                   PARTITION BY c.card_id ORDER BY c.position, i.position, i.id
               ),
               i.is_checked, i.checked_at, i.due_at, i.created_at, i.updated_at
          FROM checklist_items AS i
          JOIN checklists AS c ON c.id = i.checklist_id
        """
    )
    op.drop_table("checklist_items")
    op.drop_table("checklists")


# =========================================================== cards


def _rebuild_cards() -> None:
    """Drop the four cover/template columns by writing the target table and copying into it.

    The old table is never renamed, and the new one is renamed into place with
    `legacy_alter_table` ON. Both halves of that matter: with the pragma OFF (SQLite's default
    since 3.25) `ALTER TABLE ... RENAME` also rewrites the *references to* that table in every
    other table's foreign keys, so renaming `cards` out of the way silently repoints
    `card_labels`, `card_items` and `activities` at the temporary name, and the first insert into
    any of them afterwards fails with "no such table: main.cards_old". Creating the replacement
    beside the original, dropping the original and renaming the replacement leaves those three
    `REFERENCES cards` clauses untouched - and the pragma keeps the one rename that does happen
    from rewriting anything either.
    """
    op.execute("PRAGMA legacy_alter_table = ON")
    op.execute(CARDS_DDL)
    op.execute(f"INSERT INTO cards_new ({CARD_COLUMNS}) SELECT {CARD_COLUMNS} FROM cards")
    for name, _columns in CARD_INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {name}")
    op.execute("DROP TABLE cards")
    op.execute("ALTER TABLE cards_new RENAME TO cards")
    op.execute("PRAGMA legacy_alter_table = OFF")
    for name, columns in CARD_INDEXES:
        op.create_index(name, "cards", list(columns))


# =========================================================== activity log


def _migrate_activities() -> None:
    for old, new in RENAMED_ACTIVITY_TYPES.items():
        op.execute(
            sa.text("UPDATE activities SET type = :new WHERE type = :old").bindparams(
                new=new, old=old
            )
        )
    op.execute(
        "UPDATE activities "
        "SET data = json_remove(data, '$.checklist_id', '$.checklist_name') "
        "WHERE type LIKE 'item.%' AND json_valid(data)"
    )
    dropped = ", ".join(f"'{value}'" for value in DROPPED_ACTIVITY_TYPES)
    op.execute(f"DELETE FROM activities WHERE type IN ({dropped})")


# =========================================================== full-text search


def _drop_full_text_search() -> None:
    for trigger in ("cards_au", "cards_ad", "cards_ai"):
        op.execute(f"DROP TRIGGER IF EXISTS {trigger}")
    op.execute("DROP TABLE IF EXISTS cards_fts")


def _create_full_text_search() -> None:
    op.execute(
        """
        CREATE VIRTUAL TABLE cards_fts USING fts5(
          title, description,
          content='cards', content_rowid='id',
          tokenize='unicode61 remove_diacritics 2'
        )
        """
    )
    op.execute(
        """
        CREATE TRIGGER cards_ai AFTER INSERT ON cards BEGIN
          INSERT INTO cards_fts(rowid, title, description)
          VALUES (new.id, new.title, new.description);
        END
        """
    )
    op.execute(
        """
        CREATE TRIGGER cards_ad AFTER DELETE ON cards BEGIN
          INSERT INTO cards_fts(cards_fts, rowid, title, description)
          VALUES ('delete', old.id, old.title, old.description);
        END
        """
    )
    op.execute(
        """
        CREATE TRIGGER cards_au AFTER UPDATE OF title, description ON cards BEGIN
          INSERT INTO cards_fts(cards_fts, rowid, title, description)
          VALUES ('delete', old.id, old.title, old.description);
          INSERT INTO cards_fts(rowid, title, description)
          VALUES (new.id, new.title, new.description);
        END
        """
    )
    op.execute("INSERT INTO cards_fts(cards_fts) VALUES ('rebuild')")


# =========================================================== downgrade helpers


def _restore_cards() -> None:
    op.add_column("cards", sa.Column("cover_type", sa.Text(), nullable=True))
    op.add_column("cards", sa.Column("cover_value", sa.Text(), nullable=True))
    op.add_column(
        "cards",
        sa.Column("cover_size", sa.Text(), server_default=sa.text("'normal'"), nullable=False),
    )
    op.add_column(
        "cards",
        sa.Column("is_template", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )


def _restore_checklists() -> None:
    op.create_table(
        "checklists",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), server_default=sa.text("'Checklist'"), nullable=False),
        sa.Column("position", sa.Float(), nullable=False),
        sa.Column("created_at", sa.Text(), server_default=sa.text(NOW), nullable=False),
        sa.Column("updated_at", sa.Text(), server_default=sa.text(NOW), nullable=False),
        sa.ForeignKeyConstraint(["card_id"], ["cards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_checklists_card_position", "checklists", ["card_id", "position"])
    op.create_table(
        "checklist_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("checklist_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("position", sa.Float(), nullable=False),
        sa.Column("is_checked", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("checked_at", sa.Text(), nullable=True),
        sa.Column("due_at", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Text(), server_default=sa.text(NOW), nullable=False),
        sa.Column("updated_at", sa.Text(), server_default=sa.text(NOW), nullable=False),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 16384", name="ck_checklist_items_name_length"
        ),
        sa.CheckConstraint("is_checked IN (0, 1)", name="ck_checklist_items_is_checked"),
        sa.ForeignKeyConstraint(["checklist_id"], ["checklists.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sqlite_autoincrement=True,
    )
    op.create_index(
        "ix_checklist_items_checklist_position", "checklist_items", ["checklist_id", "position"]
    )
    op.execute(
        f"INSERT INTO checklists (id, card_id, name, position) "
        f"SELECT DISTINCT card_id, card_id, 'Checklist', {STEP} FROM card_items"
    )
    op.execute(
        "INSERT INTO checklist_items (id, checklist_id, name, position, is_checked, checked_at, "
        "due_at, created_at, updated_at) "
        "SELECT id, card_id, name, position, is_checked, checked_at, due_at, created_at, "
        "updated_at FROM card_items"
    )
    op.drop_table("card_items")


def _restore_stars_and_views() -> None:
    op.create_table(
        "board_stars",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("board_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Float(), nullable=False),
        sa.Column("created_at", sa.Text(), server_default=sa.text(NOW), nullable=False),
        sa.ForeignKeyConstraint(["board_id"], ["boards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("board_id"),
    )
    op.create_index("ix_board_stars_position", "board_stars", ["position"])
    op.create_table(
        "board_views",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("board_id", sa.Integer(), nullable=False),
        sa.Column("viewed_at", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), server_default=sa.text(NOW), nullable=False),
        sa.ForeignKeyConstraint(["board_id"], ["boards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("board_id"),
    )
    op.execute("CREATE INDEX ix_board_views_viewed ON board_views (viewed_at DESC)")


def _restore_attachments() -> None:
    op.create_table(
        "attachments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=True),
        sa.Column("mime_type", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("sha256", sa.Text(), nullable=True),
        sa.Column("is_image", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("dominant_color", sa.Text(), nullable=True),
        sa.Column("thumb_path", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Text(), server_default=sa.text(NOW), nullable=False),
        sa.Column("updated_at", sa.Text(), server_default=sa.text(NOW), nullable=False),
        sa.CheckConstraint("kind IN ('upload', 'link')", name="ck_attachments_kind"),
        sa.CheckConstraint("is_image IN (0, 1)", name="ck_attachments_is_image"),
        sa.ForeignKeyConstraint(["card_id"], ["cards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_attachments_card_created", "attachments", ["card_id", "created_at"])
