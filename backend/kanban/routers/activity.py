"""The activity feed (Sections 4.2 and 2.3.4).

Thin by contract (Section 6.4): `board_access` resolves the board, one function of
`services.activity_feed` reads the page, and the handler wraps it. A feed is a read, and a read
is never refused on a closed board (Section 4.1), which is what lets `ClosedBoardPage`'s drawer
still show what happened before the board was closed.

One route serves both feeds. The card modal's feed is this board feed narrowed by `card_id`
(Section 4.2): the two differ by a single `WHERE`, so a second `/api/cards/{card_id}/feed` route
would be the same query and the same response shape under another path.

The board's other read of the activity log, the SSE replay of `GET /api/boards/{board_id}/events`,
is not here: it answers with `EventOut` objects over `text/event-stream` (Section 4.8) and belongs
with the rest of the realtime transport.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from kanban.access import BoardCtx, board_access
from kanban.db import get_db
from kanban.schemas.activity import ActivityOut, ActivityPage
from kanban.services import activity_feed as service

router = APIRouter(tags=["activity"])

Db = Annotated[Session, Depends(get_db)]
#: A board that is not there is answered 404 by the dependency, never here.
ReadAccess = Annotated[BoardCtx, Depends(board_access())]


@router.get("/boards/{board_id}/activity", response_model=ActivityPage)
def read_board_activity(
    access: ReadAccess,
    db: Db,
    card_id: Annotated[int | None, Query(ge=1, description="Only this card's rows")] = None,
    before: Annotated[int | None, Query(ge=1, description="An activities.id to page before")] = (
        None
    ),
    limit: Annotated[int, Query(ge=1, le=service.MAX_ACTIVITY_LIMIT)] = (
        service.DEFAULT_ACTIVITY_LIMIT
    ),
) -> ActivityPage:
    """One page of activity, newest first; `card_id` narrows it to one card (Section 4.2)."""
    page = service.board_activity(
        db, board_id=access.board_id, card_id=card_id, before=before, limit=limit
    )
    return ActivityPage(
        items=[ActivityOut.model_validate(item) for item in page.items],
        next_before=page.next_before,
    )
