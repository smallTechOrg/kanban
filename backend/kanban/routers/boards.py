"""Boards, their members, stars and background library (Section 4.3).

Thin by contract (Section 6.4): every handler resolves `board_access` (which owns the member,
role and closed-board checks), calls one function of `services.boards` - or, for the board
document, `board_payload.build` (Section 6.7) - and wraps the result.
`board_version` always comes from the returned row, because `BoardSummary.version` *is* the
board version the mutation produced.

`POST /boards/{board_id}/background` is the one handler here that is not a single service call:
Section 6.9 puts the receive-and-thumbnail steps in the route precisely so they happen with no
transaction open, exactly as `routers/attachments.py` does it, and the file work itself is
`kanban/storage.py`'s.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Path, Query, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from kanban import board_payload, storage
from kanban.auth import BoardCtx, Role, board_access, current_user
from kanban.bodylimit import BACKGROUND_MAX_BYTES
from kanban.db import get_db
from kanban.models import User
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
    MemberOut,
    MemberRoleIn,
    MembersOut,
    StarOut,
)
from kanban.services import boards as service
from kanban.services import cards as cards_service
from kanban.services import lists as lists_service

router = APIRouter(tags=["boards"])

CurrentUser = Annotated[User, Depends(current_user)]
Db = Annotated[Session, Depends(get_db)]
UserId = Annotated[int, Path(ge=1)]

#: Reads need only `observer`; the closed-board guard applies to mutations, so a GET is unaffected.
ReadAccess = Annotated[BoardCtx, Depends(board_access(Role.observer))]
#: Ordinary board mutations: `member` or better, and 409 `conflict` while the board is closed.
WriteAccess = Annotated[BoardCtx, Depends(board_access(Role.member))]
#: Adding members, changing roles and closing a board.
AdminAccess = Annotated[BoardCtx, Depends(board_access(Role.admin))]
#: Reopen and delete are the two admin mutations allowed while the board is closed (Section 4.1).
ClosedAdminAccess = Annotated[BoardCtx, Depends(board_access(Role.admin, allow_closed=True))]
#: Star, unstar and "Leave board" are per-user and allowed on a closed board (Section 4.1).
PerUserAccess = Annotated[BoardCtx, Depends(board_access(Role.observer, allow_closed=True))]


@router.get("/boards", response_model=BoardGroups | ClosedBoardGroup)
def list_boards(
    user: CurrentUser,
    db: Db,
    closed: Annotated[bool, Query(description="1 for the closed boards group")] = False,
) -> BoardGroups | ClosedBoardGroup:
    """The caller's boards grouped for the home page, or the closed ones (Sections 2.2, 4.3)."""
    groups = service.list_boards(db, user, closed=closed)
    return ClosedBoardGroup(**groups) if closed else BoardGroups(**groups)


@router.post("/boards", response_model=BoardSummary, status_code=status.HTTP_201_CREATED)
def create_board(body: BoardCreateIn, user: CurrentUser, db: Db) -> BoardSummary:
    """Create a board, seeded with the caller as admin, six labels and the default lists."""
    return BoardSummary.model_validate(
        service.create_board(
            db,
            user,
            name=body.name,
            background_type=body.background_type,
            background_value=body.background_value,
            visibility=body.visibility,
            default_lists=body.default_lists,
        )
    )


@router.get("/boards/{board_id}", response_model=BoardOut)
def read_board(access: ReadAccess, user: CurrentUser, db: Db) -> JSONResponse:
    """The board document (Section 4.10.1) and the caller's `board_views` upsert.

    `board_payload.build` is the whole read: board, members, labels, the active lists and the
    active cards of those lists with their badges, in five statements (Section 6.7). Any member
    may read it, observers included, **and so may every member of a closed board**: the client
    renders `ClosedBoardPage` from `board.is_closed` (Section 2.3.5).

    The view is recorded afterwards because that per-user upsert opens a short write and so ends
    the read snapshot the payload was read in (Sections 4.1 and 4.3).

    The payload is returned as a rendered `JSONResponse` rather than a `BoardOut`; `BoardOut`
    stays the declared `response_model`, so OpenAPI and `api/types.ts` are unchanged. Section
    5.11's budget for the 3,000-card board is 100 ms, and on that fixture the round trip through
    Pydantic costs 169 ms of it: the router validates the dicts `board_payload.build` already
    shaped, FastAPI dumps that model back to dicts, validates them a second time and serialises
    through `CardSummary`'s Python `model_serializer` 3,000 times. `test_board_payload.py`
    asserts the body validates against `BoardOut` and re-serialises byte for byte, so the schema
    is still the contract - it is checked once per test run instead of once per card per request.
    """
    payload = board_payload.build(db, user, board_id=access.board.id)
    service.record_board_view(db, board_id=access.board.id, user_id=user.id)
    return JSONResponse(payload)


@router.patch("/boards/{board_id}", response_model=Mutated[BoardSummary])
def update_board(
    body: BoardUpdateIn, access: WriteAccess, user: CurrentUser, db: Db
) -> Mutated[BoardSummary]:
    """Rename a board or change its description, visibility or background (Section 4.3)."""
    item = service.update_board(
        db,
        user,
        board_id=access.board.id,
        my_role=access.member.role,
        changes=body.model_dump(exclude_unset=True),
    )
    return Mutated(item=BoardSummary.model_validate(item), board_version=item["version"])


@router.post("/boards/{board_id}/close", response_model=Mutated[BoardSummary])
def close_board(access: AdminAccess, user: CurrentUser, db: Db) -> Mutated[BoardSummary]:
    """Close a board (Trello "Close board"); admin only."""
    item = service.close_board(db, user, board_id=access.board.id, my_role=access.member.role)
    return Mutated(item=BoardSummary.model_validate(item), board_version=item["version"])


@router.post("/boards/{board_id}/reopen", response_model=Mutated[BoardSummary])
def reopen_board(access: ClosedAdminAccess, user: CurrentUser, db: Db) -> Mutated[BoardSummary]:
    """Reopen a closed board; admin only, and the one board mutation allowed while closed."""
    item = service.reopen_board(db, user, board_id=access.board.id, my_role=access.member.role)
    return Mutated(item=BoardSummary.model_validate(item), board_version=item["version"])


@router.delete("/boards/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_board(access: ClosedAdminAccess, db: Db) -> None:
    """Delete a closed board and everything in it; 409 `conflict` unless it is closed."""
    service.delete_board(db, board_id=access.board.id)


@router.put("/boards/{board_id}/star", response_model=StarOut)
def star_board(access: PerUserAccess, user: CurrentUser, db: Db) -> StarOut:
    """Star a board for the caller. Per-user state: no version bump, no activity, no event."""
    return StarOut(is_starred=service.star_board(db, user, board_id=access.board.id))


@router.delete("/boards/{board_id}/star", response_model=StarOut)
def unstar_board(access: PerUserAccess, user: CurrentUser, db: Db) -> StarOut:
    """Unstar a board for the caller; the same per-user write as `star_board`."""
    return StarOut(is_starred=service.unstar_board(db, user, board_id=access.board.id))


@router.post("/boards/{board_id}/background", response_model=Mutated[BoardSummary])
async def upload_background(
    file: Annotated[UploadFile, File(description="image/png, image/jpeg or image/webp")],
    access: WriteAccess,
    user: CurrentUser,
    db: Db,
) -> Mutated[BoardSummary]:
    """Upload a custom board background (Sections 4.3 and 6.9).

    `async def` for the reason `POST /api/cards/{card_id}/attachments` is: it awaits the received
    multipart spool, and everything after that - Pillow, and the short `write_tx` - runs in
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
        user,
        board_id=access.board.id,
        my_role=access.member.role,
        prepared=prepared,
    )
    return Mutated(item=BoardSummary.model_validate(item), board_version=item["version"])


@router.get("/boards/{board_id}/backgrounds", response_model=BoardBackgroundOut)
def list_backgrounds(access: ReadAccess, user: CurrentUser, db: Db) -> BoardBackgroundOut:
    """The colour and gradient presets plus the caller's uploaded images, for the picker.

    The board in the path is what `access` checks membership of; the custom rows are the
    caller's own `board_backgrounds` library (Section 4.3), which is not board state.
    """
    return BoardBackgroundOut.model_validate(service.list_backgrounds(db, user))


@router.get("/boards/{board_id}/archived", response_model=ArchivedCardsPage | ArchivedListsPage)
def read_archived(
    access: ReadAccess,
    user: CurrentUser,
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
    `services.lists` (which owns `ListOut`), so this handler only picks the one to call. Observer
    role suffices: it is a read.
    """
    if kind == "lists":
        rows, next_before = lists_service.list_archived_lists(
            db, board_id=access.board_id, q=q, before=before, limit=limit
        )
        return ArchivedListsPage.model_validate({"items": rows, "next_before": next_before})
    cards, next_before = cards_service.list_archived_cards(
        db, user, board_id=access.board_id, q=q, before=before, limit=limit
    )
    return ArchivedCardsPage.model_validate({"items": cards, "next_before": next_before})


@router.get("/boards/{board_id}/members", response_model=MembersOut)
def list_members(access: ReadAccess, db: Db) -> MembersOut:
    """The board's members; `MemberOut` never carries an email address."""
    return MembersOut(items=service.list_members(db, board_id=access.board.id))


@router.put("/boards/{board_id}/members/{user_id}", response_model=Mutated[MemberOut])
def set_member_role(
    user_id: UserId, body: MemberRoleIn, access: AdminAccess, user: CurrentUser, db: Db
) -> Mutated[MemberOut]:
    """Add a member or change their role; admin only. Demoting the last admin is 409."""
    item, board_version = service.set_member_role(
        db, user, board_id=access.board.id, user_id=user_id, role=body.role
    )
    return Mutated(item=MemberOut.model_validate(item), board_version=board_version)


@router.delete("/boards/{board_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(user_id: UserId, access: PerUserAccess, user: CurrentUser, db: Db) -> None:
    """Remove a member (admin), or leave the board yourself; removing the last admin is 409.

    "Leave board" is allowed even on a closed board (Section 4.1), which is why this route takes
    the per-user access dependency and hands the caller's own role to the service.
    """
    service.remove_member(
        db, user, board_id=access.board.id, user_id=user_id, actor_role=access.member.role
    )
