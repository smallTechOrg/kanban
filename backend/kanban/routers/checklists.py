"""Checklists and checklist items: the modal's `ChecklistSection` endpoints (Section 4.6).

Thin by contract (Section 6.4): a handler resolves its access dependency, calls one function of
`services.checklists` and wraps the result as `Mutated` or `MoveResult`.

`/api/checklists/{checklist_id}` and `/api/checklist-items/{item_id}` carry no `board_id` in the
path, so like the list and card routes they depend on one of the child factories of `access.py`
(`access.checklist_access` / `access.item_access`), which resolve the row's board and hand it to
`access.board_access`; the board lookup and the closed-board rule stay in `access.py` alone
(CLAUDE.md section 3), and a missing checklist or item answers 404 exactly as a missing board.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, status
from sqlalchemy.orm import Session

from kanban.access import (
    BoardCtx,
    board_access,
    card_access,
    checklist_access,
    item_access,
)
from kanban.db import get_db
from kanban.schemas.cards import CardSummary
from kanban.schemas.checklists import (
    BoardChecklistsOut,
    ChecklistCreateIn,
    ChecklistItemOut,
    ChecklistItemPatchedOut,
    ChecklistMoveResult,
    ChecklistMutated,
    ChecklistOut,
    ChecklistUpdateIn,
    ItemConvertIn,
    ItemCreateIn,
    ItemMoveIn,
    ItemMoveResult,
    ItemMutated,
    ItemPatched,
    ItemsCreated,
    ItemUpdateIn,
)
from kanban.schemas.common import MoveIn, Mutated
from kanban.services import checklists as service

router = APIRouter(tags=["checklists"])

Db = Annotated[Session, Depends(get_db)]
CardId = Annotated[int, Path(ge=1)]
ChecklistId = Annotated[int, Path(ge=1)]
ItemId = Annotated[int, Path(ge=1)]


#: The "Copy items from…" select is a read, so the closed-board guard does not apply (4.6).
BoardReadAccess = Annotated[BoardCtx, Depends(board_access())]
#: Adding a checklist writes into a card, so it resolves the card rather than a checklist.
CardWriteAccess = Annotated[BoardCtx, Depends(card_access())]
#: Every mutation addressed by checklist id.
ChecklistWriteAccess = Annotated[BoardCtx, Depends(checklist_access())]
#: Every mutation addressed by checklist item id.
ItemWriteAccess = Annotated[BoardCtx, Depends(item_access())]


@router.get("/boards/{board_id}/checklists", response_model=BoardChecklistsOut)
def read_board_checklists(access: BoardReadAccess, db: Db) -> BoardChecklistsOut:
    """Every checklist of the board whose card is visible, for "Copy items from…" (4.6)."""
    return BoardChecklistsOut(items=service.list_board_checklists(db, board_id=access.board_id))


@router.post(
    "/cards/{card_id}/checklists",
    response_model=ChecklistMutated,
    status_code=status.HTTP_201_CREATED,
)
def create_checklist(
    card_id: CardId, body: ChecklistCreateIn, access: CardWriteAccess, db: Db
) -> ChecklistMutated:
    """Add a checklist, copying another one's items when the popover selected a source (4.6)."""
    result = service.create_checklist(
        db,
        board_id=access.board_id,
        card_id=card_id,
        name=body.name,
        copy_from_checklist_id=body.copy_from_checklist_id,
    )
    return ChecklistMutated(
        item=ChecklistOut.model_validate(result.item), board_version=result.board_version
    )


@router.patch("/checklists/{checklist_id}", response_model=ChecklistMutated)
def update_checklist(
    checklist_id: ChecklistId,
    body: ChecklistUpdateIn,
    access: ChecklistWriteAccess,
    db: Db,
) -> ChecklistMutated:
    """Rename a checklist from the inline editor on its section header (Section 4.6)."""
    result = service.rename_checklist(
        db,
        board_id=access.board_id,
        checklist_id=checklist_id,
        changes=body.model_dump(exclude_unset=True),
    )
    return ChecklistMutated(
        item=ChecklistOut.model_validate(result.item), board_version=result.board_version
    )


@router.delete("/checklists/{checklist_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_checklist(checklist_id: ChecklistId, access: ChecklistWriteAccess, db: Db) -> None:
    """Delete a checklist and its items; checklists have no archive state (Section 4.6)."""
    service.delete_checklist(db, board_id=access.board_id, checklist_id=checklist_id)


@router.post("/checklists/{checklist_id}/move", response_model=ChecklistMoveResult)
def move_checklist(
    checklist_id: ChecklistId,
    body: MoveIn,
    access: ChecklistWriteAccess,
    db: Db,
) -> ChecklistMoveResult:
    """Reorder a checklist within its card: the `CHECKLIST` drag of Sections 4.6 and 2.6.3."""
    result = service.move_checklist(
        db,
        board_id=access.board_id,
        checklist_id=checklist_id,
        index=body.index,
        prev_id=body.prev_id,
        next_id=body.next_id,
    )
    return ChecklistMoveResult(
        item=ChecklistOut.model_validate(result.item),
        positions=result.positions,
        board_version=result.board_version,
    )


@router.post(
    "/checklists/{checklist_id}/items",
    response_model=ItemMutated | ItemsCreated,
    status_code=status.HTTP_201_CREATED,
)
def create_items(
    checklist_id: ChecklistId,
    body: ItemCreateIn,
    access: ChecklistWriteAccess,
    db: Db,
) -> ItemMutated | ItemsCreated:
    """Add an item, or one per pasted line when the composer answered "Add N items" (4.6)."""
    result = service.create_items(
        db,
        board_id=access.board_id,
        checklist_id=checklist_id,
        name=body.name,
        index=body.index,
        split_lines=body.split_lines,
    )
    items = [ChecklistItemOut.model_validate(item) for item in result.items]
    if body.split_lines:
        return ItemsCreated(items=items, board_version=result.board_version)
    return ItemMutated(item=items[0], board_version=result.board_version)


@router.patch("/checklist-items/{item_id}", response_model=ItemPatched)
def update_item(
    item_id: ItemId, body: ItemUpdateIn, access: ItemWriteAccess, db: Db
) -> ItemPatched:
    """Tick, rename, date or assign one item; the response carries the card's badges (4.6)."""
    result = service.update_item(
        db,
        board_id=access.board_id,
        item_id=item_id,
        changes=body.model_dump(exclude_unset=True),
    )
    return ItemPatched(
        item=ChecklistItemPatchedOut.model_validate(result.item),
        board_version=result.board_version,
    )


@router.delete("/checklist-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(item_id: ItemId, access: ItemWriteAccess, db: Db) -> None:
    """Delete one checklist item (Section 4.6)."""
    service.delete_item(db, board_id=access.board_id, item_id=item_id)


@router.post("/checklist-items/{item_id}/move", response_model=ItemMoveResult)
def move_item(item_id: ItemId, body: ItemMoveIn, access: ItemWriteAccess, db: Db) -> ItemMoveResult:
    """Drag an item within or across the checklists of its card (Sections 4.6 and 4.9)."""
    result = service.move_item(
        db,
        board_id=access.board_id,
        item_id=item_id,
        to_checklist_id=body.to_checklist_id,
        index=body.index,
        prev_id=body.prev_id,
        next_id=body.next_id,
    )
    return ItemMoveResult(
        item=ChecklistItemOut.model_validate(result.item),
        positions=result.positions,
        board_version=result.board_version,
    )


@router.post(
    "/checklist-items/{item_id}/convert",
    response_model=Mutated[CardSummary],
    status_code=status.HTTP_201_CREATED,
)
def convert_item(
    item_id: ItemId,
    access: ItemWriteAccess,
    db: Db,
    body: ItemConvertIn | None = None,
) -> Mutated[CardSummary]:
    """ "Convert to card": a new card in the same list, and the item is gone (Section 4.6).

    The item's three-dots menu sends no body at all, which is the append form of the endpoint.
    """
    result = service.convert_item_to_card(
        db,
        board_id=access.board_id,
        item_id=item_id,
        index=None if body is None else body.index,
    )
    return Mutated(item=CardSummary.model_validate(result.item), board_version=result.board_version)
