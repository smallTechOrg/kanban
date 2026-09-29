"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-09-25

Every table, index and CHECK of Section 3.4, plus the `cards_fts` FTS5 virtual table and its
three triggers, which SQLAlchemy cannot express and which are therefore created with
`op.execute()`. A later migration that batch-rebuilds `cards` must re-create those triggers and
run `INSERT INTO cards_fts(cards_fts) VALUES ('rebuild')` (Section 3.9).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: User-visible entity tables keep AUTOINCREMENT ids; a batch rebuild must pass the same flag.
AUTOINC = {"sqlite_autoincrement": True}

NOW = sa.text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))")

#: Tables in creation order; the reverse is the drop order.
TABLES = (
    "board_backgrounds",
    "boards",
    "board_stars",
    "board_views",
    "lists",
    "cards",
    "labels",
    "card_labels",
    "checklists",
    "checklist_items",
    "attachments",
    "activities",
)


def _created_at() -> sa.Column:
    return sa.Column("created_at", sa.Text(), nullable=False, server_default=NOW)


def _updated_at() -> sa.Column:
    return sa.Column("updated_at", sa.Text(), nullable=False, server_default=NOW)


def upgrade() -> None:
    _create_boards()
    _create_lists_and_cards()
    _create_labels()
    _create_checklists()
    _create_attachments()
    _create_activities()
    _create_full_text_search()


def downgrade() -> None:
    for trigger in ("cards_au", "cards_ad", "cards_ai"):
        op.execute(f"DROP TRIGGER IF EXISTS {trigger}")
    op.execute("DROP TABLE IF EXISTS cards_fts")
    for table in reversed(TABLES):
        op.drop_table(table)


# =========================================================== boards


def _create_boards() -> None:
    op.create_table(
        "board_backgrounds",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("thumb_path", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        _created_at(),
        _updated_at(),
        **AUTOINC,
    )

    op.create_table(
        "boards",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("background_type", sa.Text(), nullable=False, server_default=sa.text("'color'")),
        sa.Column(
            "background_value", sa.Text(), nullable=False, server_default=sa.text("'#0079BF'")
        ),
        sa.Column(
            "background_image_id",
            sa.Integer(),
            sa.ForeignKey("board_backgrounds.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("is_closed", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("0")),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 512", name="ck_boards_name_length"),
        sa.CheckConstraint(
            "background_type IN ('color', 'gradient', 'image')",
            name="ck_boards_background_type",
        ),
        sa.CheckConstraint("is_closed IN (0, 1)", name="ck_boards_is_closed"),
        **AUTOINC,
    )
    op.create_index("ix_boards_is_closed", "boards", ["is_closed"])

    op.create_table(
        "board_stars",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column(
            "board_id",
            sa.Integer(),
            sa.ForeignKey("boards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Float(), nullable=False),
        _created_at(),
        sa.UniqueConstraint("board_id"),
    )
    op.create_index("ix_board_stars_position", "board_stars", ["position"])

    op.create_table(
        "board_views",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column(
            "board_id",
            sa.Integer(),
            sa.ForeignKey("boards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("viewed_at", sa.Text(), nullable=False),
        _created_at(),
        sa.UniqueConstraint("board_id"),
    )
    op.create_index("ix_board_views_viewed", "board_views", [sa.text("viewed_at DESC")])


# =========================================================== lists / cards


def _create_lists_and_cards() -> None:
    op.create_table(
        "lists",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "board_id",
            sa.Integer(),
            sa.ForeignKey("boards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("position", sa.Float(), nullable=False),
        sa.Column("color", sa.Text(), nullable=True),
        sa.Column("is_archived", sa.Integer(), nullable=False, server_default=sa.text("0")),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 512", name="ck_lists_name_length"),
        sa.CheckConstraint(
            "color IS NULL OR color IN ('green', 'yellow', 'orange', 'red', 'purple', 'blue',"
            " 'sky', 'lime', 'pink', 'gray')",
            name="ck_lists_color",
        ),
        sa.CheckConstraint("is_archived IN (0, 1)", name="ck_lists_is_archived"),
        **AUTOINC,
    )
    op.create_index(
        "ix_lists_board_archived_position", "lists", ["board_id", "is_archived", "position"]
    )

    op.create_table(
        "cards",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "board_id",
            sa.Integer(),
            sa.ForeignKey("boards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "list_id",
            sa.Integer(),
            sa.ForeignKey("lists.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("short_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("position", sa.Float(), nullable=False),
        sa.Column("start_at", sa.Text(), nullable=True),
        sa.Column("due_at", sa.Text(), nullable=True),
        sa.Column("due_complete", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("due_reminder_minutes", sa.Integer(), nullable=True),
        sa.Column("cover_type", sa.Text(), nullable=True),
        sa.Column("cover_value", sa.Text(), nullable=True),
        sa.Column("cover_size", sa.Text(), nullable=False, server_default=sa.text("'normal'")),
        sa.Column("is_archived", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_template", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("client_id", sa.Text(), nullable=True),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint("length(title) BETWEEN 1 AND 16384", name="ck_cards_title_length"),
        sa.CheckConstraint("due_complete IN (0, 1)", name="ck_cards_due_complete"),
        sa.CheckConstraint(
            "cover_type IS NULL OR cover_type IN ('color', 'attachment')",
            name="ck_cards_cover_type",
        ),
        sa.CheckConstraint("cover_size IN ('normal', 'full')", name="ck_cards_cover_size"),
        sa.CheckConstraint("is_archived IN (0, 1)", name="ck_cards_is_archived"),
        sa.CheckConstraint("is_template IN (0, 1)", name="ck_cards_is_template"),
        sa.UniqueConstraint("board_id", "short_id"),
        **AUTOINC,
    )
    op.create_index(
        "ix_cards_list_archived_position", "cards", ["list_id", "is_archived", "position"]
    )
    op.create_index("ix_cards_board_archived", "cards", ["board_id", "is_archived"])
    op.create_index("ix_cards_due_at", "cards", ["due_at"])


# =========================================================== labels


def _create_labels() -> None:
    op.create_table(
        "labels",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "board_id",
            sa.Integer(),
            sa.ForeignKey("boards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("color", sa.Text(), nullable=False),
        sa.Column("tone", sa.Text(), nullable=False, server_default=sa.text("'normal'")),
        sa.Column("position", sa.Float(), nullable=False),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint(
            "color IN ('green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'lime',"
            " 'pink', 'black', 'none')",
            name="ck_labels_color",
        ),
        sa.CheckConstraint("tone IN ('subtle', 'normal', 'bold')", name="ck_labels_tone"),
        **AUTOINC,
    )
    op.create_index("ix_labels_board_position", "labels", ["board_id", "position"])

    op.create_table(
        "card_labels",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column(
            "card_id",
            sa.Integer(),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "label_id",
            sa.Integer(),
            sa.ForeignKey("labels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        _created_at(),
        sa.UniqueConstraint("card_id", "label_id"),
    )
    op.create_index("ix_card_labels_label_id", "card_labels", ["label_id"])


# =========================================================== checklists


def _create_checklists() -> None:
    op.create_table(
        "checklists",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "card_id",
            sa.Integer(),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False, server_default=sa.text("'Checklist'")),
        sa.Column("position", sa.Float(), nullable=False),
        _created_at(),
        _updated_at(),
        **AUTOINC,
    )
    op.create_index("ix_checklists_card_position", "checklists", ["card_id", "position"])

    op.create_table(
        "checklist_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "checklist_id",
            sa.Integer(),
            sa.ForeignKey("checklists.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("position", sa.Float(), nullable=False),
        sa.Column("is_checked", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("checked_at", sa.Text(), nullable=True),
        sa.Column("due_at", sa.Text(), nullable=True),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 16384", name="ck_checklist_items_name_length"
        ),
        sa.CheckConstraint("is_checked IN (0, 1)", name="ck_checklist_items_is_checked"),
        **AUTOINC,
    )
    op.create_index(
        "ix_checklist_items_checklist_position", "checklist_items", ["checklist_id", "position"]
    )


# =========================================================== attachments


def _create_attachments() -> None:
    op.create_table(
        "attachments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "card_id",
            sa.Integer(),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=True),
        sa.Column("mime_type", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("sha256", sa.Text(), nullable=True),
        sa.Column("is_image", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("dominant_color", sa.Text(), nullable=True),
        sa.Column("thumb_path", sa.Text(), nullable=True),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint("kind IN ('upload', 'link')", name="ck_attachments_kind"),
        sa.CheckConstraint("is_image IN (0, 1)", name="ck_attachments_is_image"),
        **AUTOINC,
    )
    op.create_index("ix_attachments_card_created", "attachments", ["card_id", "created_at"])


# =========================================================== activity log


def _create_activities() -> None:
    op.create_table(
        "activities",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "board_id",
            sa.Integer(),
            sa.ForeignKey("boards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "card_id",
            sa.Integer(),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "list_id",
            sa.Integer(),
            sa.ForeignKey("lists.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("data", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("board_version", sa.Integer(), nullable=False),
        _created_at(),
        **AUTOINC,
    )
    op.create_index("ix_activities_board_version", "activities", ["board_id", "board_version"])
    op.create_index("ix_activities_board_id_desc", "activities", ["board_id", sa.text("id DESC")])
    op.create_index("ix_activities_card_id_desc", "activities", ["card_id", sa.text("id DESC")])


# =========================================================== full-text search


def _create_full_text_search() -> None:
    """The FTS5 table and its triggers: raw SQL, because SQLAlchemy cannot express either."""
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
