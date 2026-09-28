"""Board labels and the card-to-label toggles (Sections 4.3 and 4.5).

Thin by contract (Section 6.4): every handler resolves an access dependency, calls one function of
`services.labels` and wraps the result in the Section 4.1 envelope. Delete is admin only, which is
`board_access(Role.admin)` here rather than a role check in the service (CLAUDE.md section 3).

The two `/api/labels/{label_id}` routes carry no `board_id` in the path, so they depend on
`auth.label_access`, which resolves the label's board and hands it to the very same
`auth.board_access` dependency every board route uses - the member, role and closed-board rules
stay in `auth.py` alone (CLAUDE.md section 8).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, status
from sqlalchemy.orm import Session

from kanban.auth import BoardCtx, Role, board_access, card_access, current_user, label_access
from kanban.db import get_db
from kanban.models import User
from kanban.schemas import Mutated
from kanban.schemas.labels import (
    CardLabelsOut,
    LabelCreateIn,
    LabelOut,
    LabelsOut,
    LabelUpdateIn,
)
from kanban.services import labels as service

router = APIRouter(tags=["labels"])

CurrentUser = Annotated[User, Depends(current_user)]
Db = Annotated[Session, Depends(get_db)]
LabelId = Annotated[int, Path(ge=1)]
CardId = Annotated[int, Path(ge=1)]


#: Reads need only `observer`; the closed-board guard applies to mutations only.
BoardReadAccess = Annotated[BoardCtx, Depends(board_access(Role.observer))]
#: Creating a label on a board: `member` or better, and 409 `conflict` while the board is closed.
BoardWriteAccess = Annotated[BoardCtx, Depends(board_access(Role.member))]
#: Renaming or recolouring a label; members may do both (Section 2.6.5).
LabelWriteAccess = Annotated[BoardCtx, Depends(label_access(Role.member))]
#: Deleting a label is admin only, a deliberate deviation from Trello (Section 4.3, Appendix B).
LabelAdminAccess = Annotated[BoardCtx, Depends(label_access(Role.admin))]
#: Toggling a label on a card is an ordinary card mutation.
CardWriteAccess = Annotated[BoardCtx, Depends(card_access(Role.member))]


@router.get("/boards/{board_id}/labels", response_model=LabelsOut)
def read_labels(access: BoardReadAccess, db: Db) -> LabelsOut:
    """The board's labels, ordered by `position` (Section 4.3)."""
    return LabelsOut(items=service.list_board_labels(db, board_id=access.board_id))


@router.post(
    "/boards/{board_id}/labels",
    response_model=Mutated[LabelOut],
    status_code=status.HTTP_201_CREATED,
)
def create_label(
    body: LabelCreateIn, access: BoardWriteAccess, user: CurrentUser, db: Db
) -> Mutated[LabelOut]:
    """Add a label to the board's palette; it is appended at the end (Section 4.3)."""
    item, board_version = service.create_label(
        db, user, board_id=access.board_id, name=body.name, color=body.color, tone=body.tone
    )
    return Mutated(item=LabelOut.model_validate(item), board_version=board_version)


@router.patch("/labels/{label_id}", response_model=Mutated[LabelOut])
def update_label(
    label_id: LabelId, body: LabelUpdateIn, access: LabelWriteAccess, user: CurrentUser, db: Db
) -> Mutated[LabelOut]:
    """Rename a label or change its colour or tone (Section 4.3)."""
    item, board_version = service.update_label(
        db,
        user,
        label_id=label_id,
        board_id=access.board_id,
        changes=body.model_dump(exclude_unset=True),
    )
    return Mutated(item=LabelOut.model_validate(item), board_version=board_version)


@router.delete("/labels/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_label(label_id: LabelId, access: LabelAdminAccess, user: CurrentUser, db: Db) -> None:
    """Delete a label and remove it from every card of the board (Section 4.3)."""
    service.delete_label(db, user, label_id=label_id, board_id=access.board_id)


@router.put("/cards/{card_id}/labels/{label_id}", response_model=CardLabelsOut)
def attach_label(
    card_id: CardId, label_id: LabelId, access: CardWriteAccess, user: CurrentUser, db: Db
) -> CardLabelsOut:
    """Put a label on a card; sending it twice changes nothing (Section 4.5)."""
    label_ids, board_version = service.attach_label(
        db, user, card_id=card_id, board_id=access.board_id, label_id=label_id
    )
    return CardLabelsOut(label_ids=label_ids, board_version=board_version)


@router.delete("/cards/{card_id}/labels/{label_id}", response_model=CardLabelsOut)
def detach_label(
    card_id: CardId, label_id: LabelId, access: CardWriteAccess, user: CurrentUser, db: Db
) -> CardLabelsOut:
    """Take a label off a card; a label it does not carry is a no-op (Section 4.5)."""
    label_ids, board_version = service.detach_label(
        db, user, card_id=card_id, board_id=access.board_id, label_id=label_id
    )
    return CardLabelsOut(label_ids=label_ids, board_version=board_version)
