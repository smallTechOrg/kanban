"""Serving the built SPA and the uploaded files (Sections 4.11, 6.9 and 6.13).

Mounted last, after every `/api` router, so an unknown `/api` path returns the JSON 404 envelope
instead of falling through to `index.html`.

`GET /uploads/{path}` is a route rather than a `StaticFiles` mount because every byte under
`data/uploads/` is private (Section 4.11): the owning row is loaded first, the caller must be a
member of that row's board, and the path must resolve inside `data/uploads/`. It is registered
here, before the SPA catch-all, for the same ordering reason the `/api` routers are.
"""

import logging
from pathlib import Path
from typing import Any, NamedTuple

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from starlette.staticfiles import StaticFiles

from kanban import storage
from kanban.auth import CurrentUser, Db, Role, board_access
from kanban.config import Settings
from kanban.errors import NotFound
from kanban.models import Attachment, Board, BoardBackground, BoardMember, Card

logger = logging.getLogger(__name__)

#: Path prefixes the SPA fallback must never answer for.
RESERVED_PREFIXES = ("api/", "uploads/")

#: Vite emits content-hashed files under /assets, so they can be cached forever.
ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable"

#: Uploads are private to the board's members, so no shared cache may keep a copy (Section 4.11).
UPLOAD_CACHE_CONTROL = "private, max-age=86400"

#: Set on every upload response: the sniffed type is the only one a browser may act on, so a
#: `.png` that is really HTML can never be rendered as HTML (Sections 4.11 and 6.9).
NOSNIFF_HEADERS = {"X-Content-Type-Options": "nosniff"}

#: The thumbnail Pillow writes is always a JPEG, whatever the original's type was.
THUMB_MIME = "image/jpeg"

#: The message an operator sees when the SPA has not been built.
MISSING_BUILD_MESSAGE = 'Frontend build not found: run "npm run build" first'


class CachedStaticFiles(StaticFiles):
    """Starlette's StaticFiles sets no Cache-Control header by default; Vite's hashed
    bundles under /assets are immutable, so add the long-cache header here.
    """

    def file_response(self, *args: Any, **kwargs: Any) -> Any:
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = ASSET_CACHE_CONTROL
        return response


def frontend_build_exists(settings: Settings) -> bool:
    """Whether `frontend/dist/index.html` is present; also what `GET /api/health` reports."""
    return (settings.frontend_dist / "index.html").is_file()


def require_frontend_build(settings: Settings) -> None:
    """Fail fast with exit code 2 when the SPA is missing, unless `KANBAN_ENV=dev`."""
    if settings.is_dev or frontend_build_exists(settings):
        return
    logger.error(MISSING_BUILD_MESSAGE)
    raise SystemExit(2)


class UploadTarget(NamedTuple):
    """One row of `GET /uploads/{path}`: what guards the file and how to send it."""

    #: The board whose membership `board_access` is asked about, or `None` when there is none the
    #: caller belongs to - which is a 404 unless `owned` already granted access.
    board_id: int | None
    media_type: str | None
    #: Images are shown in place, everything else is downloaded (Sections 4.11 and 6.9).
    inline: bool
    #: The caller uploaded this background themselves, which grants access on its own: their
    #: library outlives the boards that used it, so it is not guarded by any board (Section 6.9).
    owned: bool = False


def _upload_target(db: Session, relative: str) -> UploadTarget | None:
    """The attachment that owns `relative`, matched on `file_path` or `thumb_path`, or `None`.

    One statement, joined to `cards` for the board the permission check needs. Section 3.11 makes
    the stored path and the URL suffix the same string, so this is an equality test and never a
    second naming scheme.
    """
    row = db.execute(
        select(Card.board_id, Attachment.mime_type, Attachment.thumb_path, Attachment.is_image)
        .join(Attachment, Attachment.card_id == Card.id)
        .where(or_(Attachment.file_path == relative, Attachment.thumb_path == relative))
    ).first()
    if row is None:
        return None
    is_thumb = row.thumb_path == relative
    return UploadTarget(
        board_id=int(row.board_id),
        media_type=THUMB_MIME if is_thumb else row.mime_type,
        inline=is_thumb or bool(row.is_image),
    )


def _background_target(db: Session, relative: str, *, user_id: int) -> UploadTarget | None:
    """The `board_backgrounds` row that owns `relative`, matched the same way, or `None`.

    Section 6.9 guards a background differently from an attachment: "the uploader or a member of
    any board using the image". The uploader needs it because the picker's Custom tab lists their
    whole library, including images no board wears any more, so `owned` answers for them without a
    board at all. For anybody else this resolves *which* board is asked about - the one, among
    those whose `background_image_id` is this row, that the caller is a member of - and the
    decision itself stays `board_access`'s, exactly as it does for an attachment.
    """
    row = db.execute(
        select(
            BoardBackground.id,
            BoardBackground.user_id,
            BoardBackground.mime_type,
            BoardBackground.thumb_path,
        ).where(or_(BoardBackground.file_path == relative, BoardBackground.thumb_path == relative))
    ).first()
    if row is None:
        return None
    is_thumb = row.thumb_path == relative
    owned = int(row.user_id) == user_id
    board_id = (
        None
        if owned
        else db.execute(
            select(Board.id)
            .join(
                BoardMember,
                (BoardMember.board_id == Board.id) & (BoardMember.user_id == user_id),
            )
            .where(Board.background_image_id == row.id)
            .limit(1)
        ).scalar()
    )
    return UploadTarget(
        board_id=None if board_id is None else int(board_id),
        media_type=THUMB_MIME if is_thumb else row.mime_type,
        inline=True,
        owned=owned,
    )


def mount_static(app: FastAPI, settings: Settings) -> None:
    """Mount `/assets` and register `/uploads` plus the SPA catch-all.

    Must be called after every API router, and registers the two routes in that order: the SPA
    catch-all would otherwise answer an upload path with `index.html`.
    """
    dist: Path = settings.frontend_dist
    check_board = board_access(Role.observer)

    @app.get("/uploads/{upload_path:path}", include_in_schema=False)
    def uploaded_file(
        upload_path: str, request: Request, user: CurrentUser, db: Db
    ) -> FileResponse:
        """Serve one uploaded file to a member of the board that owns it (Section 4.11).

        400 `bad_request` when the path escapes `data/uploads/`, 401 when the caller has no
        session, and 404 `not_found` for a path with no row, a file missing from disk and a caller
        who is not a member of the owning board alike - the last is `board_access`'s own answer,
        so an attachment id reveals nothing about a board the caller cannot see.

        Two kinds of row own a file: an attachment, guarded by the board of its card, and a board
        background, guarded by its uploader or by any board using it (Section 6.9). A background
        the caller uploaded needs no board at all, which is why an unresolved board is a 404 here
        rather than a skipped check.
        """
        path = storage.resolve_upload_path(upload_path)
        target = _upload_target(db, upload_path) or _background_target(
            db, upload_path, user_id=user.id
        )
        if target is None or not path.is_file():
            raise NotFound("not_found", "That file does not exist.")
        if not target.owned:
            if target.board_id is None:
                raise NotFound("not_found", "That file does not exist.")
            # Raises 404 for a non-member, exactly as it does for a board that does not exist.
            check_board(request=request, board_id=target.board_id, user=user, db=db)
        return FileResponse(
            path,
            media_type=target.media_type,
            filename=path.name,
            content_disposition_type="inline" if target.inline else "attachment",
            headers={**NOSNIFF_HEADERS, "Cache-Control": UPLOAD_CACHE_CONTROL},
        )

    # check_dir=False: in dev the build may not exist yet, and the route should 404 rather than
    # stop the process from starting.
    assets = CachedStaticFiles(directory=dist / "assets", check_dir=False)
    app.mount("/assets", assets, name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        """Serve `index.html` so React Router owns `/b/:boardId`, `/login` and the rest."""
        if full_path.startswith(RESERVED_PREFIXES):
            raise NotFound("not_found", f"No route for /{full_path}")
        candidate = (dist / full_path).resolve()
        if full_path and candidate.is_file() and dist in candidate.parents:
            return FileResponse(candidate)
        index = dist / "index.html"
        if not index.is_file():
            raise NotFound("not_found", MISSING_BUILD_MESSAGE)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
