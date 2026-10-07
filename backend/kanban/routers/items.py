"""Card items: the modal's `ItemsSection` endpoints (Section 4.6).

Thin by contract (Section 6.4): a handler resolves its access dependency, calls one function of
`services.items` and wraps the result as `Mutated` or `MoveResult`.

`/api/card-items/{item_id}` carries no `board_id` in the path, so like the list and card routes it
depends on a child factory of `access.py` (`access.item_access`), which resolves the row's board
and hands it to `access.board_access`; the board lookup and the closed-board rule stay in
`access.py` alone (CLAUDE.md section 3), and a missing item answers 404 exactly as a missing board.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, status
from sqlalchemy.orm import Session

from kanban.access import BoardCtx, card_access, item_access
from kanban.db import get_db
from kanban.schemas.items import (
    CardItemOut,
    CardItemPatchedOut,
    ItemCreateIn,
    ItemMoveIn,
    ItemMoveResult,
    ItemMutated,
    ItemPatched,
    ItemsCreated,
    ItemUpdateIn,
)
from kanban.services import items as service

router = APIRouter(tags=["items"])

Db = Annotated[Session, Depends(get_db)]
CardId = Annotated[int, Path(ge=1)]
ItemId = Annotated[int, Path(ge=1)]

#: Adding an item writes into a card, so it resolves the card rather than the item.
CardWriteAccess = Annotated[BoardCtx, Depends(card_access())]
#: Every mutation addressed by item id.
ItemWriteAccess = Annotated[BoardCtx, Depends(item_access())]


@router.post(
    "/cards/{card_id}/items",
    response_model=ItemMutated | ItemsCreated,
    status_code=status.HTTP_201_CREATED,
)
def create_items(
    card_id: CardId, body: ItemCreateIn, access: CardWriteAccess, db: Db
) -> ItemMutated | ItemsCreated:
    """Add an item to a card, or one per pasted line with `split_lines` (Section 4.6)."""
    result = service.create_items(
        db,
        board_id=access.board_id,
        card_id=card_id,
        name=body.name,
        index=body.index,
        split_lines=body.split_lines,
    )
    items = [CardItemOut.model_validate(item) for item in result.items]
    if body.split_lines:
        return ItemsCreated(items=items, board_version=result.board_version)
    return ItemMutated(item=items[0], board_version=result.board_version)


@router.patch("/card-items/{item_id}", response_model=ItemPatched)
def update_item(
    item_id: ItemId, body: ItemUpdateIn, access: ItemWriteAccess, db: Db
) -> ItemPatched:
    """Rename, tick or re-date one item (Section 4.6).

    The response carries the card's recomputed `badges`, so ticking an item updates the tile's
    `item_done / item_total` from this one round trip.
    """
    result = service.update_item(
        db,
        board_id=access.board_id,
        item_id=item_id,
        changes=body.model_dump(exclude_unset=True),
    )
    return ItemPatched(
        item=CardItemPatchedOut.model_validate(result.item), board_version=result.board_version
    )


@router.delete("/card-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(item_id: ItemId, access: ItemWriteAccess, db: Db) -> None:
    """Delete one item (Section 4.6)."""
    service.delete_item(db, board_id=access.board_id, item_id=item_id)


@router.post("/card-items/{item_id}/move", response_model=ItemMoveResult)
def move_item(item_id: ItemId, body: ItemMoveIn, access: ItemWriteAccess, db: Db) -> ItemMoveResult:
    """Reorder an item inside its card (Sections 4.6 and 4.9).

    The card is an item's only container, so the body is `MoveIn` and nothing more.
    """
    result = service.move_item(
        db,
        board_id=access.board_id,
        item_id=item_id,
        index=body.index,
        prev_id=body.prev_id,
        next_id=body.next_id,
    )
    return ItemMoveResult(
        item=CardItemOut.model_validate(result.item),
        positions=result.positions,
        board_version=result.board_version,
    )
