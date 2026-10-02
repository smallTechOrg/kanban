"""`GET /api/meta` - the palettes the SPA reads at start-up (Section 4.7)."""

from fastapi import APIRouter

from kanban import __version__
from kanban.constants import (
    BOARD_COLORS,
    BOARD_GRADIENTS,
    LABEL_COLORS,
    LIST_COLORS,
)
from kanban.schemas import Meta

router = APIRouter(tags=["meta"])


@router.get("/meta", response_model=Meta)
def read_meta() -> Meta:
    """Serve the palettes of `constants.py`; the client holds no second copy of any of them."""
    return Meta(
        version=__version__,
        label_colors=LABEL_COLORS,
        board_colors=BOARD_COLORS,
        board_gradients=BOARD_GRADIENTS,
        list_colors=LIST_COLORS,
    )
