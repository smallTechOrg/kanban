"""Boards, their stars and their background library (Sections 4.3, 6.7 and 3.10).

Every mutation here opens exactly one `write_tx()` and records its activity rows through
`activity.record()`. The three writes that are not board state - star, unstar and the
`board_views` upsert - run inside `unversioned_write()` instead: no version bump, no activity row
and no event (Section 4.1). They describe how the reader navigates rather than what the board
contains, so a refetch must not open a version gap for the tab next to it.

The board's existence is not re-checked here; `access.board_access()` has already resolved it by
the time a router calls in (CLAUDE.md section 3).
"""

from typing import Any, Final, NamedTuple

from sqlalchemy import collate, delete, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session
from sqlalchemy.sql import ColumnElement

from kanban import activity, seed, storage
from kanban.constants import BOARD_COLORS, BOARD_GRADIENTS
from kanban.db import WriteCtx, unversioned_write, write_tx
from kanban.errors import Conflict, NotFound
from kanban.models import (
    Attachment,
    Board,
    BoardBackground,
    BoardStar,
    BoardView,
    Card,
    Label,
    utcnow_iso,
)
from kanban.ordering import between

#: "Recently viewed" shows the four most recent `board_views` rows (Sections 2.2 and 4.3).
RECENT_LIMIT: Final[int] = 4

#: Where `StaticFiles` serves `data/uploads/` from (Section 4.11).
UPLOADS_URL: Final[str] = "/uploads"


#: `attachments.kind` for a row that owns a directory under `data/uploads/attachments/`; a
#: `link` row has no file, so no cascade ever has to unlink anything for it (Section 3.11).
UPLOAD_KIND: Final[str] = "upload"


def orphaned_upload_ids(db: Session, card_filter: ColumnElement[bool]) -> list[int]:
    """Every uploaded attachment under the cards `card_filter` selects (Section 3.7).

    The three hard deletes of Section 3.7 - a card, an archived list, a closed board - each
    orphan the `attachments/{id}/` directories below them, and each has to read those ids
    *before* its transaction removes the rows. This is that read, written once; the caller hands
    the result to `storage.delete_uploads()` after its commit, because a rollback can un-delete a
    row but never a file.

    It lives here rather than in `services/attachments.py` or `services/cards.py` for the reason
    `UPLOADS_URL` does: this module is the root of the service graph - `services/cards.py`
    imports it and `services/lists.py` imports that - so it is the only one all three callers can
    reach without a cycle (CLAUDE.md section 8).
    """
    return list(
        db.execute(
            select(Attachment.id)
            .join(Card, Card.id == Attachment.card_id)
            .where(Attachment.kind == UPLOAD_KIND, card_filter)
        ).scalars()
    )


class _BoardRow(NamedTuple):
    """One row of the home-page query: the summary plus the two grouping keys."""

    item: dict[str, Any]
    star_position: float | None
    viewed_at: str | None


def _background_thumb_url(background_type: str, background_image_id: int | None) -> str | None:
    """The 400x240 thumbnail of an `image` background, `None` for colours and gradients."""
    if background_type != "image" or background_image_id is None:
        return None
    thumb_path = f"{storage.BACKGROUNDS_DIR}/{background_image_id}{storage.BACKGROUND_THUMB_SUFFIX}"
    return f"{UPLOADS_URL}/{thumb_path}"


def board_summary(board: Board, *, is_starred: bool) -> dict[str, Any]:
    """Build the `BoardSummary` of Section 4.3 from a board row and its star.

    The one place a `boards` row becomes that shape: `board_payload.py` builds the `board` key of
    the board document with it too, so the summary is written down once (CLAUDE.md section 3).
    """
    return {
        "id": board.id,
        "name": board.name,
        "description": board.description,
        "background_type": board.background_type,
        "background_value": board.background_value,
        "background_thumb_url": _background_thumb_url(
            board.background_type, board.background_image_id
        ),
        "is_closed": bool(board.is_closed),
        "version": board.version,
        "is_starred": is_starred,
        "created_at": board.created_at,
        "updated_at": board.updated_at,
    }


def _label(label: Label) -> dict[str, Any]:
    """Build the `LabelOut` of Section 4.3."""
    return {
        "id": label.id,
        "board_id": label.board_id,
        "name": label.name,
        "color": label.color,
        "tone": label.tone,
        "position": label.position,
    }


def _is_starred(db: Session, board_id: int) -> bool:
    return (
        db.execute(select(BoardStar.id).where(BoardStar.board_id == board_id)).first() is not None
    )


def _load_summary(db: Session, board_id: int) -> dict[str, Any]:
    """Re-read a board after a write so `version` and `updated_at` are the committed ones.

    `expire_on_commit` is off on the session, so the instance left over from the transaction
    still carries the pre-bump values; `populate_existing` forces the SELECT.
    """
    board = db.get(Board, board_id, populate_existing=True)
    if board is None:  # pragma: no cover - the caller holds the write lock or board_access
        raise NotFound("not_found", "That board does not exist.")
    return board_summary(board, is_starred=_is_starred(db, board_id))


def create_board(
    db: Session,
    *,
    name: str,
    background_type: str,
    background_value: str,
    default_lists: bool,
) -> dict[str, Any]:
    """Create a board and seed it, in one transaction (Sections 4.3 and 3.10).

    The transaction opens with no board ids because the board does not exist yet: the insert
    carries `version = 1` and `ctx.board_ids` / `ctx.versions` are filled from the new id, so
    `board.created` is recorded at `board_version = 1`. Seeds the six default labels and, when
    `default_lists`, the lists To Do / Doing / Done. Raises `Busy`.
    """
    with write_tx(db) as ctx:
        board = Board(
            name=name,
            background_type=background_type,
            background_value=background_value,
            version=1,
        )
        db.add(board)
        db.flush()  # the id the rest of the transaction and ctx.board_ids need
        ctx.board_ids = [board.id]
        ctx.versions[board.id] = 1
        # Per-board seeding - the six labels, the default lists and the one `board.created` row -
        # belongs to `kanban/seed.py` (Section 3.10), not here.
        seed.seed_new_board(ctx, board, default_lists=default_lists)
        board_id = board.id
    return _load_summary(db, board_id)


def list_boards(db: Session, *, closed: bool) -> dict[str, list[dict[str, Any]]]:
    """Every board, grouped for the home page (Sections 2.2 and 4.3).

    One query outer-joins the star and view rows; `closed=1` returns the single `closed` group
    instead of `starred` / `recent` / `all`.
    """
    rows = db.execute(
        select(Board, BoardStar.position, BoardView.viewed_at)
        .outerjoin(BoardStar, BoardStar.board_id == Board.id)
        .outerjoin(BoardView, BoardView.board_id == Board.id)
        .where(Board.is_closed == int(closed))
        .order_by(collate(Board.name, "NOCASE"), Board.id)
    ).all()
    entries = [
        _BoardRow(
            item=board_summary(row.Board, is_starred=row.position is not None),
            star_position=row.position,
            viewed_at=row.viewed_at,
        )
        for row in rows
    ]
    if closed:
        return {"closed": [entry.item for entry in entries]}
    starred = sorted(
        (entry for entry in entries if entry.star_position is not None),
        key=lambda entry: entry.star_position or 0.0,
    )
    recent = sorted(
        (entry for entry in entries if entry.viewed_at is not None),
        key=lambda entry: entry.viewed_at or "",
        reverse=True,
    )[:RECENT_LIMIT]
    return {
        "starred": [entry.item for entry in starred],
        "recent": [entry.item for entry in recent],
        "all": [entry.item for entry in entries],
    }


def list_labels(db: Session, *, board_id: int) -> list[dict[str, Any]]:
    """The board's labels ordered by `position` (Section 4.3)."""
    labels = (
        db.execute(
            select(Label).where(Label.board_id == board_id).order_by(Label.position, Label.id)
        )
        .scalars()
        .all()
    )
    return [_label(label) for label in labels]


def record_board_view(db: Session, *, board_id: int) -> None:
    """Upsert the board's `board_views` row, which drives "Recently viewed" (Section 4.3).

    One of the writes that bypass `write_tx` (Section 4.1): a single statement inside
    `unversioned_write()`, no version bump, no activity row and no event, so opening a board never
    opens a version gap on the tab beside it.
    """
    statement = sqlite_insert(BoardView).values(board_id=board_id, viewed_at=utcnow_iso())
    statement = statement.on_conflict_do_update(
        index_elements=[BoardView.board_id],
        set_={"viewed_at": statement.excluded.viewed_at},
    )
    with unversioned_write(db):
        db.execute(statement)


def _background(db: Session, *, background_id: int) -> BoardBackground:
    """One uploaded background. Raises `NotFound` when there is no such image."""
    background = db.get(BoardBackground, background_id)
    if background is None:
        raise NotFound("not_found", "That background image is not in the library.")
    return background


def _wear_image_background(
    ctx: WriteCtx, board: Board, *, background_id: int, file_path: str
) -> None:
    """Point `board` at one uploaded image and record the one `board.background_changed` row.

    The three columns and the activity row are the same whether the image has just been uploaded
    (`upload_background`) or re-selected from the library (`update_board`), and getting
    `background_image_id` wrong in one of them silently breaks `background_thumb_url`, so the
    rule is written here once (CLAUDE.md rule 2).
    """
    board.background_type = "image"
    board.background_value = f"{UPLOADS_URL}/{file_path}"
    board.background_image_id = background_id
    activity.record(
        ctx,
        "board.background_changed",
        background_type=board.background_type,
        background_value=board.background_value,
    )


def update_board(db: Session, *, board_id: int, changes: dict[str, Any]) -> dict[str, Any]:
    """Patch a board, one activity row per changed field (Sections 4.3 and 3.8).

    `changes` is the `exclude_unset` dump of `BoardUpdateIn`. Setting a colour or gradient
    background clears `background_image_id` (the image stays in the library);
    `background_image_id` re-selects one, and raises `NotFound` when there is no such image.
    """
    background = (
        _background(db, background_id=changes["background_image_id"])
        if "background_image_id" in changes
        else None
    )
    with write_tx(db, [board_id]) as ctx:
        board = db.get(Board, board_id, populate_existing=True)
        if board is None:  # pragma: no cover - board_access resolved it a moment ago
            raise NotFound("not_found", "That board does not exist.")
        if "name" in changes and changes["name"] != board.name:
            activity.record(
                ctx,
                "board.renamed",
                **{"from": board.name, "to": changes["name"]},
            )
            board.name = changes["name"]
        if "description" in changes and changes["description"] != board.description:
            board.description = changes["description"]
            activity.record(ctx, "board.description_changed")
        if "background_type" in changes:
            board.background_type = changes["background_type"]
            board.background_value = changes["background_value"]
            board.background_image_id = None
            activity.record(
                ctx,
                "board.background_changed",
                background_type=board.background_type,
                background_value=board.background_value,
            )
        if background is not None:
            _wear_image_background(
                ctx, board, background_id=background.id, file_path=background.file_path
            )
    return _load_summary(db, board_id)


def close_board(db: Session, *, board_id: int) -> dict[str, Any]:
    """Close a board: it leaves the home groups and joins `closed=1` (Sections 3.7 and 4.3).

    Activity `board.closed`.
    """
    with write_tx(db, [board_id]) as ctx:
        board = db.get(Board, board_id, populate_existing=True)
        if board is None:  # pragma: no cover - board_access resolved it a moment ago
            raise NotFound("not_found", "That board does not exist.")
        board.is_closed = 1
        activity.record(ctx, "board.closed")
    return _load_summary(db, board_id)


def reopen_board(db: Session, *, board_id: int) -> dict[str, Any]:
    """Reopen a closed board: the one board mutation allowed while `is_closed` (Section 4.3).

    Activity `board.reopened`.
    """
    with write_tx(db, [board_id]) as ctx:
        board = db.get(Board, board_id, populate_existing=True)
        if board is None:  # pragma: no cover - board_access resolved it a moment ago
            raise NotFound("not_found", "That board does not exist.")
        board.is_closed = 0
        activity.record(ctx, "board.reopened")
    return _load_summary(db, board_id)


def delete_board(db: Session, *, board_id: int) -> None:
    """Hard-delete a closed board and cascade its rows (Sections 3.7 and 4.3).

    Raises `Conflict` unless the board is closed, which is the whole state machine:
    close first, then delete. No activity row is recorded because the log itself cascades away
    with the board, and the `boards.version` bump `write_tx` writes on the way out updates a row
    that no longer exists, which SQLite treats as the no-op it is. Every attachment directory
    below the board is removed after the commit (Section 3.7).
    """
    with write_tx(db, [board_id]):
        board = db.get(Board, board_id, populate_existing=True)
        if board is None:  # pragma: no cover - board_access resolved it a moment ago
            raise NotFound("not_found", "That board does not exist.")
        if not board.is_closed:
            raise Conflict(
                "conflict", "Close the board before deleting it.", {"board_id": board_id}
            )
        doomed = orphaned_upload_ids(db, Card.board_id == board_id)
        db.delete(board)
    storage.delete_uploads(doomed)


def star_board(db: Session, *, board_id: int) -> bool:
    """Star a board, appended at `max(position) + STEP` (Section 4.3).

    Not board state: it is allowed on a closed board, it runs in `unversioned_write()` and it
    bumps no version, records no activity and publishes no event. Repeating it is idempotent.
    """
    with unversioned_write(db):
        highest = db.execute(select(func.max(BoardStar.position))).scalar()
        statement = sqlite_insert(BoardStar).values(
            board_id=board_id, position=between(highest, None)
        )
        db.execute(statement.on_conflict_do_nothing(index_elements=[BoardStar.board_id]))
    return True


def unstar_board(db: Session, *, board_id: int) -> bool:
    """Unstar a board; idempotent, and the same write as `star_board`."""
    with unversioned_write(db):
        db.execute(delete(BoardStar).where(BoardStar.board_id == board_id))
    return False


def upload_background(
    db: Session,
    *,
    board_id: int,
    prepared: storage.PreparedBackground,
) -> dict[str, Any]:
    """Store an uploaded image and make it this board's background (Sections 4.3 and 6.9).

    The bytes have already been received, sniffed and thumbnailed into `uploads/tmp/` by the
    route, so the write lock is held only for steps 4-7 of Section 6.9. The
    `board_backgrounds` row is inserted first because both files are named after the id SQLite
    assigns inside the transaction; `file_path`, `thumb_path` and the board's three background
    columns are therefore written as a second statement of the same transaction, and no client
    ever sees the interim state. Any failure rolls the row back and deletes both the temp files
    and anything already renamed into place, so a crash leaves at most an orphan file that
    `cleanup-orphans` removes, never a dangling row.

    The image joins the install's library rather than the board's: a later board keeps
    re-selecting it through `background_image_id` (`update_board`), and closing or deleting the
    board leaves it there. Activity `board.background_changed`, the one row a colour or gradient
    change records too. Raises `NotFound` when the board is gone and `Busy` (503) on a lock
    timeout.
    """
    background_id: int | None = None
    try:
        with write_tx(db, [board_id]) as ctx:
            board = db.get(Board, board_id, populate_existing=True)
            if board is None:  # pragma: no cover - board_access resolved it a moment ago
                raise NotFound("not_found", "That board does not exist.")
            row = BoardBackground(
                file_path="",  # the id below is what names the files, so neither path exists yet
                thumb_path="",
                mime_type=prepared.mime_type,
                size_bytes=prepared.size_bytes,
                width=prepared.width,
                height=prepared.height,
            )
            db.add(row)
            db.flush()
            background_id = int(row.id)
            stored = storage.place_background(background_id, prepared)
            row.file_path = stored.file_path
            row.thumb_path = stored.thumb_path
            _wear_image_background(
                ctx, board, background_id=background_id, file_path=stored.file_path
            )
    except BaseException:
        if background_id is not None:
            storage.delete_background(background_id)
        raise
    finally:
        storage.discard_background(prepared)  # a no-op once `place_background` has renamed them
    return _load_summary(db, board_id)


def list_backgrounds(db: Session) -> dict[str, list[dict[str, Any]]]:
    """The `GET /api/meta` presets plus the uploaded library, for the picker (Section 4.3)."""
    images = db.execute(select(BoardBackground).order_by(BoardBackground.id.desc())).scalars().all()
    return {
        "colors": [{"key": key, "hex": value} for key, value in BOARD_COLORS.items()],
        "gradients": [{"key": key, "css": value} for key, value in BOARD_GRADIENTS.items()],
        "custom": [
            {
                "id": image.id,
                "url": f"{UPLOADS_URL}/{image.file_path}",
                "thumb_url": f"{UPLOADS_URL}/{image.thumb_path}",
            }
            for image in images
        ],
    }
