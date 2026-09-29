"""SQLAlchemy models - the schema source of truth (Section 3.4).

Every table, column, default, CHECK constraint, foreign-key rule and index below is the ORM
expression of the DDL in Section 3.4 of docs/PLANNING.md, and Alembic migration `0001_initial`
renders exactly this schema. Two things SQLAlchemy cannot express live only in that migration and
must be re-created by any later migration that batch-rebuilds `cards`:

* the `cards_fts` FTS5 virtual table, and
* its `cards_ai` / `cards_ad` / `cards_au` triggers.

See `backend/alembic/versions/0001_initial.py`.
"""

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Final

from sqlalchemy import (
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from kanban.constants import DEFAULT_BOARD_COLOR, LABEL_COLORS, LIST_COLORS

#: Every user-visible entity table carries `INTEGER PRIMARY KEY AUTOINCREMENT`; the join tables
#: use the plain rowid alias (Section 6.5.3). SQLAlchemy only emits AUTOINCREMENT when asked, and
#: a batch migration must pass the same flag or the rebuilt table loses it. The plain rowid tables
#: therefore say nothing at all: `autoincrement=False` would change no DDL (SQLite writes
#: `id INTEGER` + `PRIMARY KEY (id)` either way) but would stop the ORM reading the rowid back, so
#: `db.add(CardLabel(...))` would raise `FlushError: NULL identity key`.
AUTOINC: Final[dict[str, bool]] = {"sqlite_autoincrement": True}

#: The DDL default of every `created_at` / `updated_at` column.
NOW_SQL: Final[str] = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"


def utcnow_iso(*, days: int = 0) -> str:
    """The one helper that produces an ISO-8601 UTC timestamp string (CLAUDE.md section 4).

    `days` shifts the instant, which only the `--demo` fixture needs: Section 3.10 asks it for a
    card "due tomorrow" and an overdue one, and a second `datetime.now()` there would be exactly
    the ad-hoc timestamp that rule forbids. Every other caller wants the default, now.
    """
    return (datetime.now(UTC) + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _in_check(column: str, values: Iterable[str]) -> str:
    """Render `column IN ('a', 'b')` from constants.py so no palette is written down twice."""
    rendered = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({rendered})"


class Base(DeclarativeBase):
    """Declarative base; `Base.metadata` is Alembic's `target_metadata`."""


class TimestampMixin:
    """`created_at` + `updated_at`, on every mutable table (Section 3.2)."""

    created_at: Mapped[str] = mapped_column(Text, nullable=False, server_default=text(NOW_SQL))
    updated_at: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text(NOW_SQL), onupdate=utcnow_iso
    )


class CreatedAtMixin:
    """`created_at` only: the join tables and the immutable `activities` log (Section 3.2)."""

    created_at: Mapped[str] = mapped_column(Text, nullable=False, server_default=text(NOW_SQL))


# =========================================================== boards


class BoardBackground(TimestampMixin, Base):
    """Custom uploaded background images: the install's library."""

    __tablename__ = "board_backgrounds"
    __table_args__ = AUTOINC

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    #: 'backgrounds/{id}.{ext}' relative to data/uploads/.
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    #: 'backgrounds/{id}.thumb.jpg' (400x240 cover crop).
    thumb_path: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)


class Board(TimestampMixin, Base):
    __tablename__ = "boards"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 512", name="ck_boards_name_length"),
        CheckConstraint(
            _in_check("background_type", ("color", "gradient", "image")),
            name="ck_boards_background_type",
        ),
        CheckConstraint("is_closed IN (0, 1)", name="ck_boards_is_closed"),
        Index("ix_boards_is_closed", "is_closed"),
        AUTOINC,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    #: Markdown, "About this board".
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    background_type: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'color'")
    )
    #: hex for 'color', preset key for 'gradient', '/uploads/backgrounds/{id}.{ext}' for 'image'.
    background_value: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text(f"'{DEFAULT_BOARD_COLOR}'")
    )
    background_image_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("board_backgrounds.id", ondelete="SET NULL")
    )
    is_closed: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    #: Bumped by every write inside the board; the realtime cursor.
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))


class BoardStar(CreatedAtMixin, Base):
    """The starred boards of Section 2.2, ordered."""

    __tablename__ = "board_stars"
    __table_args__ = (
        UniqueConstraint("board_id"),
        Index("ix_board_stars_position", "position"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    board_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("boards.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[float] = mapped_column(Float, nullable=False)


class BoardView(CreatedAtMixin, Base):
    """The recently viewed boards of Section 2.2: the top 4 by `viewed_at`."""

    __tablename__ = "board_views"
    __table_args__ = (
        UniqueConstraint("board_id"),
        Index("ix_board_views_viewed", text("viewed_at DESC")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    board_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("boards.id", ondelete="CASCADE"), nullable=False
    )
    viewed_at: Mapped[str] = mapped_column(Text, nullable=False)


# =========================================================== lists / cards


class List(TimestampMixin, Base):
    __tablename__ = "lists"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 512", name="ck_lists_name_length"),
        CheckConstraint(
            f"color IS NULL OR {_in_check('color', LIST_COLORS)}", name="ck_lists_color"
        ),
        CheckConstraint("is_archived IN (0, 1)", name="ck_lists_is_archived"),
        Index("ix_lists_board_archived_position", "board_id", "is_archived", "position"),
        AUTOINC,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    board_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("boards.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    position: Mapped[float] = mapped_column(Float, nullable=False)
    color: Mapped[str | None] = mapped_column(Text)
    is_archived: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))


class Card(TimestampMixin, Base):
    __tablename__ = "cards"
    __table_args__ = (
        CheckConstraint("length(title) BETWEEN 1 AND 16384", name="ck_cards_title_length"),
        CheckConstraint("due_complete IN (0, 1)", name="ck_cards_due_complete"),
        CheckConstraint(
            f"cover_type IS NULL OR {_in_check('cover_type', ('color', 'attachment'))}",
            name="ck_cards_cover_type",
        ),
        CheckConstraint(_in_check("cover_size", ("normal", "full")), name="ck_cards_cover_size"),
        CheckConstraint("is_archived IN (0, 1)", name="ck_cards_is_archived"),
        CheckConstraint("is_template IN (0, 1)", name="ck_cards_is_template"),
        UniqueConstraint("board_id", "short_id"),
        Index("ix_cards_list_archived_position", "list_id", "is_archived", "position"),
        Index("ix_cards_board_archived", "board_id", "is_archived"),
        Index("ix_cards_due_at", "due_at"),
        AUTOINC,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    #: Denormalised `lists.board_id`, kept in step by every move.
    board_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("boards.id", ondelete="CASCADE"), nullable=False
    )
    list_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("lists.id", ondelete="CASCADE"), nullable=False
    )
    #: Per-board "#12"; MAX(short_id) + 1 inside the write transaction.
    short_id: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    #: Markdown.
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    position: Mapped[float] = mapped_column(Float, nullable=False)
    start_at: Mapped[str | None] = mapped_column(Text)
    due_at: Mapped[str | None] = mapped_column(Text)
    due_complete: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    #: NULL, 0, 5, 10, 15, 60, 120, 1440 or 2880.
    due_reminder_minutes: Mapped[int | None] = mapped_column(Integer)
    cover_type: Mapped[str | None] = mapped_column(Text)
    #: Palette key for 'color'; `attachments.id` as text for 'attachment'.
    cover_value: Mapped[str | None] = mapped_column(Text)
    cover_size: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'normal'"))
    is_archived: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    is_template: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    #: Optional 'tmp_<32 hex>' echoed back for an optimistic create.
    client_id: Mapped[str | None] = mapped_column(Text)


# =========================================================== labels


class Label(TimestampMixin, Base):
    __tablename__ = "labels"
    __table_args__ = (
        CheckConstraint(_in_check("color", LABEL_COLORS), name="ck_labels_color"),
        CheckConstraint(_in_check("tone", ("subtle", "normal", "bold")), name="ck_labels_tone"),
        Index("ix_labels_board_position", "board_id", "position"),
        AUTOINC,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    board_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("boards.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    color: Mapped[str] = mapped_column(Text, nullable=False)
    tone: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'normal'"))
    position: Mapped[float] = mapped_column(Float, nullable=False)


class CardLabel(CreatedAtMixin, Base):
    __tablename__ = "card_labels"
    __table_args__ = (
        UniqueConstraint("card_id", "label_id"),
        Index("ix_card_labels_label_id", "label_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    card_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("cards.id", ondelete="CASCADE"), nullable=False
    )
    label_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("labels.id", ondelete="CASCADE"), nullable=False
    )


# =========================================================== checklists


class Checklist(TimestampMixin, Base):
    __tablename__ = "checklists"
    __table_args__ = (
        Index("ix_checklists_card_position", "card_id", "position"),
        AUTOINC,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    card_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("cards.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'Checklist'"))
    position: Mapped[float] = mapped_column(Float, nullable=False)


class ChecklistItem(TimestampMixin, Base):
    __tablename__ = "checklist_items"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 16384", name="ck_checklist_items_name_length"),
        CheckConstraint("is_checked IN (0, 1)", name="ck_checklist_items_is_checked"),
        Index("ix_checklist_items_checklist_position", "checklist_id", "position"),
        AUTOINC,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    checklist_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("checklists.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    position: Mapped[float] = mapped_column(Float, nullable=False)
    is_checked: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    checked_at: Mapped[str | None] = mapped_column(Text)
    due_at: Mapped[str | None] = mapped_column(Text)


# =========================================================== attachments


class Attachment(TimestampMixin, Base):
    __tablename__ = "attachments"
    __table_args__ = (
        CheckConstraint(_in_check("kind", ("upload", "link")), name="ck_attachments_kind"),
        CheckConstraint("is_image IN (0, 1)", name="ck_attachments_is_image"),
        Index("ix_attachments_card_created", "card_id", "created_at"),
        AUTOINC,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    card_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("cards.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    #: Original filename or link display text.
    name: Mapped[str] = mapped_column(Text, nullable=False)
    #: '/uploads/attachments/{id}/{safe_name}' or the external URL.
    url: Mapped[str] = mapped_column(Text, nullable=False)
    #: 'attachments/{id}/{safe_name}' relative to data/uploads/; NULL for links.
    file_path: Mapped[str | None] = mapped_column(Text)
    mime_type: Mapped[str | None] = mapped_column(Text)
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    sha256: Mapped[str | None] = mapped_column(Text)
    is_image: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    #: '#RRGGBB' computed by Pillow, images only.
    dominant_color: Mapped[str | None] = mapped_column(Text)
    #: 'attachments/{id}/thumb.jpg', a 512x256 cover crop, images only.
    thumb_path: Mapped[str | None] = mapped_column(Text)


# =========================================================== activity log (immutable)


class Activity(CreatedAtMixin, Base):
    """One immutable row per write; also the durable event log replayed over SSE."""

    __tablename__ = "activities"
    __table_args__ = (
        Index("ix_activities_board_version", "board_id", "board_version"),
        Index("ix_activities_board_id_desc", "board_id", text("id DESC")),
        Index("ix_activities_card_id_desc", "card_id", text("id DESC")),
        AUTOINC,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    board_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("boards.id", ondelete="CASCADE"), nullable=False
    )
    card_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("cards.id", ondelete="CASCADE"))
    list_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("lists.id", ondelete="SET NULL")
    )
    #: One of `constants.ACTIVITY_TYPES` (Section 3.8).
    type: Mapped[str] = mapped_column(Text, nullable=False)
    #: JSON object; the names a sentence needs are denormalised at write time.
    data: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'{}'"))
    #: `boards.version` after this write; the SSE cursor.
    board_version: Mapped[int] = mapped_column(Integer, nullable=False)
