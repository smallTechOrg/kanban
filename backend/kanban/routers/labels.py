"""Board labels and the card-to-label toggles (Sections 4.3 and 4.5).

Thin by contract (Section 6.4): every handler resolves an access dependency, calls one function of
`services.labels` and wraps the result in the Section 4.1 envelope. Which board a request may touch
is `board_access()` / `label_access()`'s answer, never a second lookup in the service (CLAUDE.md
section 3).

The two `/api/labels/{label_id}` routes carry no `board_id` in the path, so they depend on
`access.label_access`, which resolves the label's board and hands it to the very same
`access.board_access` dependency every board route uses - the board lookup and the closed-board
rule stay in `access.py` alone (CLAUDE.md section 8).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, status
from sqlalchemy.orm import Session

from kanban.access import BoardCtx, board_access, card_access, label_access
from kanban.db import get_db
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

Db = Annotated[Session, Depends(get_db)]
LabelId = Annotated[int, Path(ge=1)]
CardId = Annotated[int, Path(ge=1)]


#: A `/api/boards/{board_id}/labels` route: the board, and 409 `conflict` for a write while it is
#: closed. A read shares it, because that guard never applies to a GET.
BoardAccess = Annotated[BoardCtx, Depends(board_access())]
#: A `/api/labels/{label_id}` route: the label's board, then the same two rules.
LabelAccess = Annotated[BoardCtx, Depends(label_access())]
#: Toggling a label on a card resolves the card instead.
CardAccess = Annotated[BoardCtx, Depends(card_access())]


@router.get("/boards/{board_id}/labels", response_model=LabelsOut)
def read_labels(access: BoardAccess, db: Db) -> LabelsOut:
    """The board's labels, ordered by `position` (Section 4.3)."""
    return LabelsOut(items=service.list_board_labels(db, board_id=access.board_id))


@router.post(
    "/boards/{board_id}/labels",
    response_model=Mutated[LabelOut],
    status_code=status.HTTP_201_CREATED,
)
def create_label(body: LabelCreateIn, access: BoardAccess, db: Db) -> Mutated[LabelOut]:
    """Add a label to the board's palette; it is appended at the end (Section 4.3)."""
    item, board_version = service.create_label(
        db, board_id=access.board_id, name=body.name, color=body.color, tone=body.tone
    )
    return Mutated(item=LabelOut.model_validate(item), board_version=board_version)


@router.patch("/labels/{label_id}", response_model=Mutated[LabelOut])
def update_label(
    label_id: LabelId, body: LabelUpdateIn, access: LabelAccess, db: Db
) -> Mutated[LabelOut]:
    """Rename a label or change its colour or tone (Section 4.3)."""
    item, board_version = service.update_label(
        db,
        label_id=label_id,
        board_id=access.board_id,
        changes=body.model_dump(exclude_unset=True),
    )
    return Mutated(item=LabelOut.model_validate(item), board_version=board_version)


@router.delete("/labels/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_label(label_id: LabelId, access: LabelAccess, db: Db) -> None:
    """Delete a label and remove it from every card of the board (Section 4.3)."""
    service.delete_label(db, label_id=label_id, board_id=access.board_id)


@router.put("/cards/{card_id}/labels/{label_id}", response_model=CardLabelsOut)
def attach_label(card_id: CardId, label_id: LabelId, access: CardAccess, db: Db) -> CardLabelsOut:
    """Put a label on a card; sending it twice changes nothing (Section 4.5)."""
    label_ids, board_version = service.attach_label(
        db, card_id=card_id, board_id=access.board_id, label_id=label_id
    )
    return CardLabelsOut(label_ids=label_ids, board_version=board_version)


@router.delete("/cards/{card_id}/labels/{label_id}", response_model=CardLabelsOut)
def detach_label(card_id: CardId, label_id: LabelId, access: CardAccess, db: Db) -> CardLabelsOut:
    """Take a label off a card; a label it does not carry is a no-op (Section 4.5)."""
    label_ids, board_version = service.detach_label(
        db, card_id=card_id, board_id=access.board_id, label_id=label_id
    )
    return CardLabelsOut(label_ids=label_ids, board_version=board_version)
