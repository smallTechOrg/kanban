"""`GET /api/meta` - the palettes and flags the SPA reads before it authenticates (Section 4.7)."""

from typing import Annotated

from fastapi import APIRouter, Depends

from kanban import __version__
from kanban.config import Settings, get_settings
from kanban.constants import (
    ADMIN_USERNAME,
    AVATAR_COLORS,
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
    """Serve `constants.py` and the public `Settings` flags. Public: no authentication."""
    return Meta(
        version=__version__,
        label_colors=LABEL_COLORS,
        cover_colors=COVER_COLORS,
        board_colors=BOARD_COLORS,
        avatar_colors=list(AVATAR_COLORS),
        board_gradients=BOARD_GRADIENTS,
        list_colors=LIST_COLORS,
        max_upload_mb=settings.max_upload_mb,
        signup_enabled=settings.allow_signup,
        single_user=settings.single_user,
        admin_username=ADMIN_USERNAME,
    )
