"""The application factory and the startup sequence (Sections 6.3 and 6.4)."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware import Middleware

from kanban import __version__
from kanban.access import CsrfHeaderMiddleware
from kanban.bodylimit import BodySizeLimitMiddleware
from kanban.config import settings
from kanban.db import engine, upgrade_to_head
from kanban.errors import register_exception_handlers
from kanban.events import bus as event_bus
from kanban.logging_conf import configure_logging
from kanban.middleware import RequestIdMiddleware
from kanban.ratelimit import RateLimitMiddleware
from kanban.routers import (
    activity,
    boards,
    cards,
    events,
    health,
    items,
    labels,
    lists,
    meta,
    search,
)
from kanban.static import mount_static, require_frontend_build

logger = logging.getLogger(__name__)

#: The Vite dev server; CORS is enabled for it only when `KANBAN_ENV=dev` (Section 4.11).
DEV_ORIGIN = "http://localhost:5173"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Prepare the data directory, migrate and verify the SPA build."""
    settings.ensure_directories()
    upgrade_to_head()
    require_frontend_build(settings)
    # The bus is created at import time so `write_tx` can publish without reaching into the app;
    # binding the loop here is what makes `loop.call_soon_threadsafe` legal from a worker thread.
    event_bus.loop = asyncio.get_running_loop()
    app.state.bus = event_bus
    logger.info("My Day %s ready (env=%s, db=%s)", __version__, settings.env, settings.db_path)
    yield
    engine.dispose()


def create_app() -> FastAPI:
    """Build the application. Middleware is listed outermost first (Section 6.3 step 4)."""
    configure_logging(settings)

    middleware = [Middleware(RequestIdMiddleware)]
    if settings.is_dev:
        middleware.append(
            Middleware(
                CORSMiddleware,
                allow_origins=[DEV_ORIGIN],
                allow_methods=["*"],
                allow_headers=["Content-Type", "X-Requested-With"],
            )
        )
    # Section 6.4 steps 4-6, outermost first: a request that busts the bucket or carries no CSRF
    # header is answered before the body limit wraps `receive()` and before any dependency runs.
    middleware.append(Middleware(RateLimitMiddleware))
    middleware.append(Middleware(CsrfHeaderMiddleware))
    middleware.append(Middleware(BodySizeLimitMiddleware))

    app = FastAPI(
        title="My Day API",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
        middleware=middleware,
    )
    register_exception_handlers(app)

    app.include_router(health.router, prefix="/api")
    app.include_router(meta.router, prefix="/api")
    app.include_router(boards.router, prefix="/api")
    app.include_router(lists.router, prefix="/api")
    app.include_router(cards.router, prefix="/api")
    app.include_router(labels.router, prefix="/api")
    app.include_router(items.router, prefix="/api")
    app.include_router(activity.router, prefix="/api")
    app.include_router(events.router, prefix="/api")
    app.include_router(search.router, prefix="/api")

    # Last, so `/api/*` is matched before the SPA catch-all.
    mount_static(app, settings)
    return app


app = create_app()
