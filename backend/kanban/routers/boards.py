"""Boards and their background library (Section 4.3).

Thin by contract (Section 6.4): every handler resolves `board_access` (which owns the board lookup
and the closed-board check), calls one function of `services.boards` - or, for the board document,
`board_payload.build` (Section 6.7) - and wraps the result. `board_version` always comes from the
returned row, because `BoardSummary.version` *is* the board version the mutation produced.

`POST /boards/{board_id}/background` is the one handler here that is not a single service call:
Section 6.9 puts the receive-and-thumbnail steps in the route precisely so they happen with no
transaction open, and the file work itself is `kanban/storage.py`'s.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from kanban import board_payload, storage
from kanban.access import BoardCtx, board_access
from kanban.bodylimit import BACKGROUND_MAX_BYTES
from kanban.db import get_db
from kanban.schemas import Mutated
from kanban.schemas.archived import ArchivedCardsPage, ArchivedListsPage
from kanban.schemas.boards import (
    BoardBackgroundOut,
    BoardCreateIn,
    BoardGroups,
    BoardOut,
    BoardSummary,
    BoardUpdateIn,
    ClosedBoardGroup,
)
from kanban.services import boards as service
from kanban.services import cards as cards_service
from kanban.services import lists as lists_service

router = APIRouter(tags=["boards"])

Db = Annotated[Session, Depends(get_db)]

#: What every route here declares: the board, 404 when it is not there, and 409 `conflict` for a
#: mutation while it is closed. A GET is unaffected by that guard, so reads share this dependency.
BoardAccess = Annotated[BoardCtx, Depends(board_access())]
#: Reopen, delete and star/unstar are the mutations allowed while the board is closed (4.1).
ClosedBoardAccess = Annotated[BoardCtx, Depends(board_access(allow_closed=True))]


@router.get("/boards", response_model=BoardGroups | ClosedBoardGroup)
def list_boards(
    db: Db,
    closed: Annotated[bool, Query(description="1 for the closed boards group")] = False,
) -> BoardGroups | ClosedBoardGroup:
    """Every board grouped for the home page, or the closed ones (Sections 2.2 and 4.3)."""
    groups = service.list_boards(db, closed=closed)
    return ClosedBoardGroup(**groups) if closed else BoardGroups(**groups)


@router.post("/boards", response_model=BoardSummary, status_code=status.HTTP_201_CREATED)
def create_board(body: BoardCreateIn, db: Db) -> BoardSummary:
    """Create a board, seeded with the caller as admin, six labels and the default lists."""
    return BoardSummary.model_validate(
        service.create_board(
            db,
            name=body.name,
            background_type=body.background_type,
            background_value=body.background_value,
            default_lists=body.default_lists,
        )
    )


@router.get("/boards/{board_id}", response_model=BoardOut)
def read_board(access: BoardAccess, db: Db) -> JSONResponse:
    """The board document of Section 4.10.1.

    `board_payload.build` is the whole read: board, labels, the active lists and the
    active cards of those lists with their badges, in four statements (Section 6.7). It is served
    **even while the board is closed**: the client
    renders `ClosedBoardPage` from `board.is_closed` (Section 2.3.5).

    The payload is returned as a rendered `JSONResponse` rather than a `BoardOut`; `BoardOut`
    stays the declared `response_model`, so OpenAPI and `api/types.ts` are unchanged. Section
    5.11's budget for the 3,000-card board is 100 ms, and on that fixture the round trip through
    Pydantic costs 169 ms of it: the router validates the dicts `board_payload.build` already
    shaped, FastAPI dumps that model back to dicts, validates them a second time and serialises
    through `CardSummary`'s Python `model_serializer` 3,000 times. `test_board_payload.py`
    asserts the body validates against `BoardOut` and re-serialises byte for byte, so the schema
    is still the contract - it is checked once per test run instead of once per card per request.
    """
    return JSONResponse(board_payload.build(db, board_id=access.board.id))


@router.patch("/boards/{board_id}", response_model=Mutated[BoardSummary])
def update_board(body: BoardUpdateIn, access: BoardAccess, db: Db) -> Mutated[BoardSummary]:
    """Rename a board or change its description or background (Section 4.3)."""
    item = service.update_board(
        db,
        board_id=access.board.id,
        changes=body.model_dump(exclude_unset=True),
    )
    return Mutated(item=BoardSummary.model_validate(item), board_version=item["version"])


@router.post("/boards/{board_id}/close", response_model=Mutated[BoardSummary])
def close_board(access: BoardAccess, db: Db) -> Mutated[BoardSummary]:
    """Close a board (Trello "Close board")."""
    item = service.close_board(db, board_id=access.board.id)
    return Mutated(item=BoardSummary.model_validate(item), board_version=item["version"])


@router.post("/boards/{board_id}/reopen", response_model=Mutated[BoardSummary])
def reopen_board(access: ClosedBoardAccess, db: Db) -> Mutated[BoardSummary]:
    """Reopen a closed board, and the one board mutation allowed while closed."""
    item = service.reopen_board(db, board_id=access.board.id)
    return Mutated(item=BoardSummary.model_validate(item), board_version=item["version"])


@router.delete("/boards/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_board(access: ClosedBoardAccess, db: Db) -> None:
    """Delete a closed board and everything in it; 409 `conflict` unless it is closed."""
    service.delete_board(db, board_id=access.board.id)


@router.post("/boards/{board_id}/background", response_model=Mutated[BoardSummary])
async def upload_background(
    file: Annotated[UploadFile, File(description="image/png, image/jpeg or image/webp")],
    access: BoardAccess,
    db: Db,
) -> Mutated[BoardSummary]:
    """Upload a custom board background (Sections 4.3 and 6.9).

    `async def` because it awaits the received multipart spool, after which everything - Pillow,
    and the short `write_tx` - runs in
    `run_in_threadpool`, so the event loop is never blocked and the write lock is never held
    while bytes or thumbnails are in flight. `Content-Length` is required and the 10 MB cap
    enforced by `BodySizeLimitMiddleware` before the body is read (411 / 413), so this handler
    only ever sees a body that fits; `BACKGROUND_MAX_BYTES` is passed on as the belt-and-braces
    check inside `save_upload`, from the module that owns that number rather than a second copy.
    A type that is not PNG, JPEG or WebP is 415, which `storage.prepare_background` decides from
    the bytes.
    """
    received = await storage.save_upload(file, max_bytes=BACKGROUND_MAX_BYTES)
    prepared = await run_in_threadpool(storage.prepare_background, received)
    item = await run_in_threadpool(
        service.upload_background,
        db,
        board_id=access.board.id,
        prepared=prepared,
    )
    return Mutated(item=BoardSummary.model_validate(item), board_version=item["version"])


@router.get("/boards/{board_id}/backgrounds", response_model=BoardBackgroundOut)
def list_backgrounds(access: BoardAccess, db: Db) -> BoardBackgroundOut:
    """The colour and gradient presets plus the uploaded images, for the picker (Section 4.3).

    The board in the path is what `access` resolves; the custom rows are the install's
    `board_backgrounds` library, which is not board state - an image outlives the boards that
    wore it.
    """
    return BoardBackgroundOut.model_validate(service.list_backgrounds(db))


@router.get("/boards/{board_id}/archived", response_model=ArchivedCardsPage | ArchivedListsPage)
def read_archived(
    access: BoardAccess,
    db: Db,
    kind: Annotated[
        Literal["cards", "lists"], Query(alias="type", description="Which archive to page")
    ] = "cards",
    q: Annotated[str | None, Query(max_length=512, description="Title/name substring")] = None,
    before: Annotated[int | None, Query(ge=1, description="The id to page before")] = None,
    limit: Annotated[int, Query(ge=1, le=cards_service.MAX_ARCHIVED_PAGE_LIMIT)] = (
        cards_service.ARCHIVED_PAGE_LIMIT
    ),
) -> ArchivedCardsPage | ArchivedListsPage:
    """One page of the board's archived cards or lists, for the Archived Items panel (4.3).

    `type` is the panel's own switch, and each aggregate answers for its own rows: the archived
    cards come from `services.cards` (which owns `CardSummary`) and the archived lists from
    `services.lists` (which owns `ListOut`), so this handler only picks the one to call.
    """
    if kind == "lists":
        rows, next_before = lists_service.list_archived_lists(
            db, board_id=access.board_id, q=q, before=before, limit=limit
        )
        return ArchivedListsPage.model_validate({"items": rows, "next_before": next_before})
    cards, next_before = cards_service.list_archived_cards(
        db, board_id=access.board_id, q=q, before=before, limit=limit
    )
    return ArchivedCardsPage.model_validate({"items": cards, "next_before": next_before})
