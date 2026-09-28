"""The application factory and the startup sequence (Sections 6.3 and 6.4)."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from starlette.middleware import Middleware

from kanban import __version__, seed
from kanban.auth import CsrfHeaderMiddleware
from kanban.bodylimit import BodySizeLimitMiddleware
from kanban.config import settings
from kanban.db import SessionLocal, engine, upgrade_to_head
from kanban.errors import register_exception_handlers
from kanban.events import bus as event_bus
from kanban.logging_conf import configure_logging
from kanban.middleware import RequestIdMiddleware
from kanban.models import utcnow_iso
from kanban.ratelimit import RateLimitMiddleware
from kanban.routers import (
    activity,
    attachments,
    auth,
    boards,
    cards,
    checklists,
    comments,
    events,
    health,
    labels,
    lists,
    members,
    meta,
    search,
    users,
)
from kanban.static import mount_static, require_frontend_build

logger = logging.getLogger(__name__)

#: The Vite dev server; CORS is enabled for it only when `KANBAN_ENV=dev` (Section 4.11).
DEV_ORIGIN = "http://localhost:5173"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Prepare the data directory, migrate, prune sessions and verify the SPA build."""
    settings.ensure_directories()
    settings.resolve_secret()
    upgrade_to_head()
    _prune_expired_sessions()
    _bootstrap_single_user_admin()
    require_frontend_build(settings)
    # The bus is created at import time so `write_tx` can publish without reaching into the app;
    # binding the loop here is what makes `loop.call_soon_threadsafe` legal from a worker thread.
    event_bus.loop = asyncio.get_running_loop()
    app.state.bus = event_bus
    logger.info("Kan Ban %s ready (env=%s, db=%s)", __version__, settings.env, settings.db_path)
    yield
    engine.dispose()


def _prune_expired_sessions() -> None:
    """Delete sessions whose TTL has passed. A failure here must not stop the process."""
    try:
        # execution_options(write=True) is what makes the `begin` listener emit BEGIN IMMEDIATE.
        with engine.connect().execution_options(write=True) as conn, conn.begin():
            pruned = conn.execute(
                text("DELETE FROM sessions WHERE expires_at < :now"), {"now": utcnow_iso()}
            ).rowcount
        if pruned:
            logger.info("Pruned %s expired session(s)", pruned)
    except Exception:
        logger.exception("Could not prune expired sessions")


def _bootstrap_single_user_admin() -> None:
    """Step 4 of Section 6.3: create `admin` when `KANBAN_SINGLE_USER=1` and it is missing.

    `seed.bootstrap_admin` owns the rule (Section 3.10) and is a no-op when the flag is off. An
    empty `KANBAN_ADMIN_PASSWORD` raises, which must stop the process: a single-user install
    whose only account cannot log in is not a usable server.
    """
    db = SessionLocal()
    try:
        if seed.bootstrap_admin(db):
            logger.info("Bootstrapped the %r account (KANBAN_SINGLE_USER=1)", seed.ADMIN_USERNAME)
    finally:
        db.rollback()
        db.close()


def create_app() -> FastAPI:
    """Build the application. Middleware is listed outermost first (Section 6.3 step 4)."""
    configure_logging(settings)

    middleware = [Middleware(RequestIdMiddleware)]
    if settings.is_dev:
        middleware.append(
            Middleware(
                CORSMiddleware,
                allow_origins=[DEV_ORIGIN],
                allow_credentials=True,
                allow_methods=["*"],
                allow_headers=["Content-Type", "X-Requested-With", "Authorization"],
            )
        )
    # Section 6.4 steps 4-6, outermost first: a request that busts a bucket or carries no CSRF
    # header is answered before the body limit wraps `receive()` and before any dependency runs.
    middleware.append(Middleware(RateLimitMiddleware))
    middleware.append(Middleware(CsrfHeaderMiddleware))
    middleware.append(
        Middleware(
            BodySizeLimitMiddleware,
            max_upload_bytes=settings.max_upload_mb * 1024 * 1024,
        )
    )

    app = FastAPI(
        title="Kan Ban API",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
        middleware=middleware,
    )
    register_exception_handlers(app)

    app.include_router(health.router, prefix="/api")
    app.include_router(meta.router, prefix="/api")
    app.include_router(auth.router, prefix="/api")
    app.include_router(users.router, prefix="/api")
    app.include_router(boards.router, prefix="/api")
    app.include_router(lists.router, prefix="/api")
    app.include_router(cards.router, prefix="/api")
    app.include_router(labels.router, prefix="/api")
    app.include_router(members.router, prefix="/api")
    app.include_router(attachments.router, prefix="/api")
    app.include_router(checklists.router, prefix="/api")
    app.include_router(comments.router, prefix="/api")
    app.include_router(activity.router, prefix="/api")
    app.include_router(events.router, prefix="/api")
    app.include_router(search.router, prefix="/api")

    # Last, so `/api/*` is matched before the SPA catch-all.
    mount_static(app, settings)
    return app


app = create_app()
