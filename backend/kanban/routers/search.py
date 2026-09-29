"""`GET /api/search` - the two groups `SearchPopover` renders (Sections 2.1.1 and 4.7).

Thin by contract (CLAUDE.md section 2): bind the three query parameters, call `search.search()`
once and wrap what it returns. It declares no `board_access` dependency, because a search spans
every board rather than naming one; which rows a search may return - open boards, active cards - is
inside the statements themselves (Section 4.7).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from kanban import search as service
from kanban.db import get_db
from kanban.schemas.search import SearchResults

router = APIRouter(tags=["search"])

Db = Annotated[Session, Depends(get_db)]


@router.get("/search", response_model=SearchResults)
def search(
    db: Db,
    q: Annotated[
        str, Query(max_length=service.MAX_QUERY_LENGTH, description="The typed search text")
    ] = "",
    board_id: Annotated[int | None, Query(ge=1, description="Narrow to one board")] = None,
    limit: Annotated[int, Query(ge=1, le=service.MAX_SEARCH_LIMIT)] = service.DEFAULT_SEARCH_LIMIT,
) -> SearchResults:
    """Matching boards and cards for `q` (Section 4.7).

    `q` has no minimum length here - the popover sends every debounced keystroke and `q=` must
    answer with empty groups it can render, not the 422 a `min_length` would produce
    (`SearchPopover` itself only asks once two characters are typed, Section 5.4.1).
    """
    return SearchResults(**service.search(db, q=q, board_id=board_id, limit=limit))
