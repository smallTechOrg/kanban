"""`GET /api/meta` - the palettes and limits the SPA reads at start-up (Section 4.7)."""

from typing import Annotated

from fastapi import APIRouter, Depends

from kanban import __version__
from kanban.config import Settings, get_settings
from kanban.constants import (
    BOARD_COLORS,
    BOARD_GRADIENTS,
    COVER_COLORS,
    LABEL_COLORS,
    LIST_COLORS,
)
from kanban.schemas import Meta

router = APIRouter(tags=["meta"])


@router.get("/meta", response_model=Meta)
def read_meta(settings: Annotated[Settings, Depends(get_settings)]) -> Meta:
    """Serve `constants.py` and the one public `Settings` limit the client has to know."""
    return Meta(
        version=__version__,
        label_colors=LABEL_COLORS,
        cover_colors=COVER_COLORS,
        board_colors=BOARD_COLORS,
        board_gradients=BOARD_GRADIENTS,
        list_colors=LIST_COLORS,
        max_upload_mb=settings.max_upload_mb,
    )
