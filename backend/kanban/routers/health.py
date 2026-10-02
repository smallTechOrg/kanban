"""`GET /api/health` - the reverse-proxy health check (Section 4.7)."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from kanban import __version__
from kanban.config import Settings, get_settings
from kanban.db import get_db
from kanban.schemas import Health
from kanban.static import frontend_build_exists

router = APIRouter(tags=["meta"])


@router.get("/health", response_model=Health)
def read_health(
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Health:
    """Report process, database and SPA-build health. Public: no authentication."""
    db.execute(text("SELECT 1"))
    return Health(
        status="ok",
        db="ok",
        version=__version__,
        frontend_build=frontend_build_exists(settings),
    )
