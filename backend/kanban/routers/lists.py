"""List columns and the bulk card operations of the list menu (Section 4.4).

Thin by contract (Section 6.4): every handler resolves an access dependency, calls one function of
`services.lists` and wraps the result in the Section 4.1 envelope. The `/api/lists/{list_id}`
routes carry no `board_id` in the path, so they depend on `auth.list_access`, which resolves the
list and hands its `board_id` to the very same `auth.board_access` dependency the board routes
use - the member, role and closed-board rules stay in `auth.py` alone (CLAUDE.md section 3).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, status
from sqlalchemy.orm import Session

from kanban.auth import BoardCtx, Role, board_access, current_user, list_access
from kanban.db import get_db
from kanban.models import User
from kanban.schemas import MoveResult, Mutated
from kanban.schemas.lists import (
    ArchiveAllCardsOut,
    ListCopyIn,
    ListCreateIn,
    ListMoveIn,
    ListOut,
    ListSortIn,
    ListsOut,
    ListUpdateIn,
    MoveAllCardsIn,
    MoveAllCardsOut,
    PositionsOut,
    UnarchiveCardsIn,
    UnarchiveCardsOut,
)
from kanban.services import lists as service

router = APIRouter(tags=["lists"])

CurrentUser = Annotated[User, Depends(current_user)]
Db = Annotated[Session, Depends(get_db)]
ListId = Annotated[int, Path(ge=1)]


#: Reads need only `observer`; the closed-board guard applies to mutations only.
BoardReadAccess = Annotated[BoardCtx, Depends(board_access(Role.observer))]
#: Creating a list on a board: `member` or better, and 409 `conflict` while the board is closed.
BoardWriteAccess = Annotated[BoardCtx, Depends(board_access(Role.member))]
#: Every mutation addressed by list id.
ListWriteAccess = Annotated[BoardCtx, Depends(list_access(Role.member))]


@router.get("/boards/{board_id}/lists", response_model=ListsOut)
def read_lists(access: BoardReadAccess, db: Db) -> ListsOut:
    """The board's active lists with their active card counts (Section 4.4)."""
    return ListsOut(items=service.list_lists(db, board_id=access.board_id))


@router.post(
    "/boards/{board_id}/lists",
    response_model=Mutated[ListOut],
    status_code=status.HTTP_201_CREATED,
)
def create_list(
    body: ListCreateIn, access: BoardWriteAccess, user: CurrentUser, db: Db
) -> Mutated[ListOut]:
    """Add a list; an absent `index` appends it at the end of the board (Section 4.4)."""
    item, board_version = service.create_list(
        db, user, board_id=access.board_id, name=body.name, index=body.index
    )
    return Mutated(item=ListOut.model_validate(item), board_version=board_version)


@router.patch("/lists/{list_id}", response_model=Mutated[ListOut])
def update_list(
    list_id: ListId, body: ListUpdateIn, access: ListWriteAccess, user: CurrentUser, db: Db
) -> Mutated[ListOut]:
    """Rename a list or change its colour; `color: null` removes it (Section 4.4)."""
    item, board_version = service.update_list(
        db,
        user,
        list_id=list_id,
        board_id=access.board_id,
        changes=body.model_dump(exclude_unset=True),
    )
    return Mutated(item=ListOut.model_validate(item), board_version=board_version)


@router.post("/lists/{list_id}/move", response_model=MoveResult[ListOut])
def move_list(
    list_id: ListId, body: ListMoveIn, access: ListWriteAccess, user: CurrentUser, db: Db
) -> MoveResult[ListOut]:
    """Reorder a list, or hand it and its cards to another board (Sections 4.9, 5.5 and 3.6).

    A `to_board_id` naming another board answers with *that* board's `board_version`; the caller's
    right to write there is checked by the service, because the id is in the body.
    """
    item, positions, board_version = service.move_list(
        db,
        user,
        list_id=list_id,
        board_id=access.board_id,
        index=body.index,
        prev_id=body.prev_id,
        next_id=body.next_id,
        to_board_id=body.to_board_id,
    )
    return MoveResult(
        item=ListOut.model_validate(item), positions=positions, board_version=board_version
    )


@router.post(
    "/lists/{list_id}/copy", response_model=Mutated[ListOut], status_code=status.HTTP_201_CREATED
)
def copy_list(
    list_id: ListId, body: ListCopyIn, access: ListWriteAccess, user: CurrentUser, db: Db
) -> Mutated[ListOut]:
    """Copy a list and its active cards; an absent `index` lands after the source (Section 4.4)."""
    item, board_version = service.copy_list(
        db, user, list_id=list_id, board_id=access.board_id, name=body.name, index=body.index
    )
    return Mutated(item=ListOut.model_validate(item), board_version=board_version)


@router.post("/lists/{list_id}/archive", response_model=Mutated[ListOut])
def archive_list(
    list_id: ListId, access: ListWriteAccess, user: CurrentUser, db: Db
) -> Mutated[ListOut]:
    """Archive a list; its cards are hidden with it and keep their positions (Section 3.7)."""
    item, board_version = service.archive_list(db, user, list_id=list_id, board_id=access.board_id)
    return Mutated(item=ListOut.model_validate(item), board_version=board_version)


@router.post("/lists/{list_id}/unarchive", response_model=Mutated[ListOut])
def unarchive_list(
    list_id: ListId, access: ListWriteAccess, user: CurrentUser, db: Db
) -> Mutated[ListOut]:
    """Send an archived list back to the board, into its old slot (Sections 3.6 and 4.4)."""
    item, board_version = service.unarchive_list(
        db, user, list_id=list_id, board_id=access.board_id
    )
    return Mutated(item=ListOut.model_validate(item), board_version=board_version)


@router.delete("/lists/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_list(list_id: ListId, access: ListWriteAccess, db: Db) -> None:
    """Delete an archived list and cascade its cards; 409 `conflict` unless archived (3.7)."""
    service.delete_list(db, list_id=list_id, board_id=access.board_id)


@router.post("/lists/{list_id}/move-all-cards", response_model=MoveAllCardsOut)
def move_all_cards(
    list_id: ListId, body: MoveAllCardsIn, access: ListWriteAccess, user: CurrentUser, db: Db
) -> MoveAllCardsOut:
    """Move every active card of this list to another list of the same board (Section 4.4)."""
    moved, positions, board_version = service.move_all_cards(
        db, user, list_id=list_id, board_id=access.board_id, to_list_id=body.to_list_id
    )
    return MoveAllCardsOut(moved=moved, positions=positions, board_version=board_version)


@router.post("/lists/{list_id}/archive-all-cards", response_model=ArchiveAllCardsOut)
def archive_all_cards(
    list_id: ListId, access: ListWriteAccess, user: CurrentUser, db: Db
) -> ArchiveAllCardsOut:
    """Archive every card of a list; `archived_ids` feeds the Undo toast (Section 4.4)."""
    archived_ids, board_version = service.archive_all_cards(
        db, user, list_id=list_id, board_id=access.board_id
    )
    return ArchiveAllCardsOut(
        archived=len(archived_ids), archived_ids=archived_ids, board_version=board_version
    )


@router.post("/lists/{list_id}/unarchive-cards", response_model=UnarchiveCardsOut)
def unarchive_cards(
    list_id: ListId, body: UnarchiveCardsIn, access: ListWriteAccess, user: CurrentUser, db: Db
) -> UnarchiveCardsOut:
    """The Undo of "Archive all cards": restore the listed cards of this list (Section 4.4)."""
    restored, board_version = service.unarchive_cards(
        db, user, list_id=list_id, board_id=access.board_id, card_ids=body.card_ids
    )
    return UnarchiveCardsOut(restored=restored, board_version=board_version)


@router.post("/lists/{list_id}/sort", response_model=PositionsOut)
def sort_list(
    list_id: ListId, body: ListSortIn, access: ListWriteAccess, user: CurrentUser, db: Db
) -> PositionsOut:
    """Sort a list's cards by name, newest, oldest or due date (Sections 4.4 and 3.6)."""
    positions, board_version = service.sort_list(
        db, user, list_id=list_id, board_id=access.board_id, by=body.by
    )
    return PositionsOut(positions=positions, board_version=board_version)
