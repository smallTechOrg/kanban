"""Cards: the composer, the title patch, the move contract and the archive state machine (4.5).

Thin by contract (Section 6.4): a handler resolves its access dependency, calls one function of
`services.cards` and wraps the result as `Mutated` or `MoveResult`. Because these routes are keyed
by a child id, the access dependencies come from `access.py` - `card_access` for `/api/cards/...`
and the very same `list_access` the list routes use for the composer - so the board a card or list
belongs to is resolved and authorised in one place (step 4 of Section 6.7.2). A missing row and a
missing board both answer 404 `not_found`.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, status
from sqlalchemy.orm import Session

from kanban.access import BoardCtx, card_access, list_access
from kanban.db import get_db
from kanban.schemas.cards import (
    CardCreateIn,
    CardDetail,
    CardMoveIn,
    CardMoveResult,
    CardMutated,
    CardsCreated,
    CardSummary,
    CardUpdateIn,
)
from kanban.services import cards as service

router = APIRouter(tags=["cards"])

Db = Annotated[Session, Depends(get_db)]
CardId = Annotated[int, Path(ge=1)]
ListId = Annotated[int, Path(ge=1)]

#: A `/api/cards/{card_id}` route: the card's board, and 409 `conflict` for a mutation while that
#: board is closed. A read shares it, because the guard never applies to a GET.
CardAccess = Annotated[BoardCtx, Depends(card_access())]
#: The composer writes into a list, so it resolves the list rather than a card.
ListWriteAccess = Annotated[BoardCtx, Depends(list_access())]


@router.post(
    "/lists/{list_id}/cards",
    response_model=CardMutated | CardsCreated,
    status_code=status.HTTP_201_CREATED,
)
def create_card(
    list_id: ListId, body: CardCreateIn, access: ListWriteAccess, db: Db
) -> CardMutated | CardsCreated:
    """Add a card to a list, or one card per pasted line with `split_lines` (Section 4.4).

    The response echoes `client_id` so the optimistic tile keeps its React key (Section 5.4.2).
    """
    result = service.create_card(
        db,
        board_id=access.board_id,
        list_id=list_id,
        title=body.title,
        index=body.index,
        client_id=body.client_id,
        label_ids=body.label_ids,
        split_lines=body.split_lines,
    )
    items = [CardSummary.model_validate(item) for item in result.items]
    if body.split_lines:
        return CardsCreated(items=items, board_version=result.board_version)
    return CardMutated(item=items[0], board_version=result.board_version)


@router.get("/cards/{card_id}", response_model=CardDetail)
def read_card(card_id: CardId, access: CardAccess, db: Db) -> CardDetail:
    """The whole card the modal renders, archived ones included for the banner (Section 4.5)."""
    return CardDetail.model_validate(service.get_card(db, card_id=card_id))


@router.patch("/cards/{card_id}", response_model=CardMutated)
def update_card(card_id: CardId, body: CardUpdateIn, access: CardAccess, db: Db) -> CardMutated:
    """Patch a card's scalar fields (Section 4.5). Moving and archiving have their own routes."""
    result = service.update_card(
        db,
        board_id=access.board_id,
        card_id=card_id,
        changes=body.model_dump(exclude_unset=True),
    )
    return CardMutated(
        item=CardSummary.model_validate(result.item), board_version=result.board_version
    )


@router.post("/cards/{card_id}/move", response_model=CardMoveResult)
@router.patch("/cards/{card_id}/move", response_model=CardMoveResult)
def move_card(card_id: CardId, body: CardMoveIn, access: CardAccess, db: Db) -> CardMoveResult:
    """The drag-and-drop endpoint (Sections 4.9 and 6.7.2); `PATCH` is the documented alias.

    `positions` is empty unless the destination had to be renumbered, in which case the client
    writes every listed position into its cache before re-sorting. The destination is a list of
    the board this route already resolved: a card never changes board (Section 3.6).
    """
    result = service.move_card(
        db,
        board_id=access.board_id,
        card_id=card_id,
        to_list_id=body.to_list_id,
        index=body.index,
        prev_id=body.prev_id,
        next_id=body.next_id,
    )
    return CardMoveResult(
        item=CardSummary.model_validate(result.item),
        positions=result.positions,
        board_version=result.board_version,
    )


@router.post("/cards/{card_id}/archive", response_model=CardMutated)
def archive_card(card_id: CardId, access: CardAccess, db: Db) -> CardMutated:
    """Archive a card; its `position` is kept so "Send to board" restores the slot (3.7)."""
    result = service.archive_card(db, board_id=access.board_id, card_id=card_id)
    return CardMutated(
        item=CardSummary.model_validate(result.item), board_version=result.board_version
    )


@router.post("/cards/{card_id}/unarchive", response_model=CardMutated)
def unarchive_card(card_id: CardId, access: CardAccess, db: Db) -> CardMutated:
    """ "Send to board". 409 `conflict` when the board has no active list left (Section 3.6)."""
    result = service.unarchive_card(db, board_id=access.board_id, card_id=card_id)
    return CardMutated(
        item=CardSummary.model_validate(result.item), board_version=result.board_version
    )


@router.delete("/cards/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_card(card_id: CardId, access: CardAccess, db: Db) -> None:
    """Delete a card and its items (Section 3.7). The card need not be archived first."""
    service.delete_card(db, board_id=access.board_id, card_id=card_id)
