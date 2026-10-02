"""Serving the built SPA and the uploaded files (Sections 4.11, 6.9 and 6.13).

Mounted last, after every `/api` router, so an unknown `/api` path returns the JSON 404 envelope
instead of falling through to `index.html`.

`GET /uploads/{path}` is a route rather than a `StaticFiles` mount, for three reasons
(Section 4.11): the path must resolve inside `data/uploads/`, so no `..` can escape it; the
response's `Content-Type` is the type the row recorded when the bytes were sniffed rather than one
guessed from the extension, which is what makes `X-Content-Type-Options: nosniff` mean anything;
and a path with no row behind it is a 404, so a file left on disk by a crashed upload is never
served. It is registered here, before the SPA catch-all, for the same ordering reason the `/api`
routers are.
"""

import logging
from pathlib import Path
from typing import Any, NamedTuple

from fastapi import FastAPI
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from starlette.staticfiles import StaticFiles

from kanban import storage
from kanban.access import Db
from kanban.config import Settings
from kanban.errors import NotFound
from kanban.models import BoardBackground

logger = logging.getLogger(__name__)

#: Path prefixes the SPA fallback must never answer for.
RESERVED_PREFIXES = ("api/", "uploads/")

#: Vite emits content-hashed files under /assets, so they can be cached forever.
ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable"

#: An upload belongs to this install, so no shared cache may keep a copy (Section 4.11).
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
    """One row of `GET /uploads/{path}`: how the file is to be sent."""

    #: The type recorded when the bytes were sniffed, which is the only one the browser is told.
    media_type: str | None


def _background_target(db: Session, relative: str) -> UploadTarget | None:
    """The `board_backgrounds` row that owns `relative`, matched the same way, or `None`.

    A background is matched independently of any board: the picker's Custom tab lists the whole
    library, including images no board wears any more, so the row itself is what makes the file
    servable (Section 6.9).
    """
    row = db.execute(
        select(BoardBackground.mime_type, BoardBackground.thumb_path).where(
            or_(BoardBackground.file_path == relative, BoardBackground.thumb_path == relative)
        )
    ).first()
    if row is None:
        return None
    return UploadTarget(media_type=THUMB_MIME if row.thumb_path == relative else row.mime_type)


def mount_static(app: FastAPI, settings: Settings) -> None:
    """Mount `/assets` and register `/uploads` plus the SPA catch-all.

    Must be called after every API router, and registers the two routes in that order: the SPA
    catch-all would otherwise answer an upload path with `index.html`.
    """
    dist: Path = settings.frontend_dist

    @app.get("/uploads/{upload_path:path}", include_in_schema=False)
    def uploaded_file(upload_path: str, db: Db) -> FileResponse:
        """Serve one uploaded file, as its own row describes it (Section 4.11).

        400 `bad_request` when the path escapes `data/uploads/`, and 404 `not_found` for a path
        with no row behind it and for a row whose file is missing from disk alike. One kind of row
        owns a file, a board background, and it carries the media type its bytes were sniffed as,
        which is the only type the response ever names - and it is always an image, so every
        upload is served inline.
        """
        path = storage.resolve_upload_path(upload_path)
        target = _background_target(db, upload_path)
        if target is None or not path.is_file():
            raise NotFound("not_found", "That file does not exist.")
        return FileResponse(
            path,
            media_type=target.media_type,
            filename=path.name,
            content_disposition_type="inline",
            headers={**NOSNIFF_HEADERS, "Cache-Control": UPLOAD_CACHE_CONTROL},
        )

    # check_dir=False: in dev the build may not exist yet, and the route should 404 rather than
    # stop the process from starting.
    assets = CachedStaticFiles(directory=dist / "assets", check_dir=False)
    app.mount("/assets", assets, name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        """Serve `index.html` so React Router owns `/b/:boardId` and the rest."""
        if full_path.startswith(RESERVED_PREFIXES):
            raise NotFound("not_found", f"No route for /{full_path}")
        candidate = (dist / full_path).resolve()
        if full_path and candidate.is_file() and dist in candidate.parents:
            return FileResponse(candidate)
        index = dist / "index.html"
        if not index.is_file():
            raise NotFound("not_found", MISSING_BUILD_MESSAGE)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
