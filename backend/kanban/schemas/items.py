"""Card-item shapes (Section 4.6).

`Mutated`, `MoveResult` and the single move body `MoveIn` are declared once for the whole API in
`schemas/common.py` (Sections 4.1 and 4.9); this module imports them and adds only what an item
needs. `CardBadges` comes from `schemas/common.py` because the item patch answers with the card's
recomputed badges - the very same object `CardSummary.badges` carries - so the tile can patch
`item_done` / `item_total` without refetching the board (Section 4.6); it is shared rather than
owned by `schemas/cards.py`, which embeds `CardItemOut` in `CardDetail`.
"""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from kanban.schemas.common import CardBadges, IsoTimestamp, MoveIn, MoveResult, Mutated

#: `card_items.name`: 1-16384, the same limit as a card title (Section 4.1). A `split_lines`
#: paste is validated as one body and split per line by the service.
ItemName = Annotated[str, StringConstraints(min_length=1, max_length=16384)]

#: A 0-based slot over the card's items (Section 3.6); absent appends.
ItemIndex = Annotated[int, Field(ge=0)]


class CardItemOut(BaseModel):
    """One item of a card, as Section 4.6 types it."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    card_id: int
    name: str
    position: float
    is_checked: bool
    checked_at: str | None
    due_at: str | None


class CardItemPatchedOut(CardItemOut):
    """`PATCH /api/card-items/{item_id}`: the item plus the card's recomputed badges.

    Section 4.6 types the response as `CardItemOut & {badges}` so ticking an item updates the
    tile's `item_done / item_total` from the same round trip.
    """

    badges: CardBadges


#: The wrappers of Sections 4.1 and 4.9, parametrised once for items.
ItemMutated = Mutated[CardItemOut]
ItemPatched = Mutated[CardItemPatchedOut]
ItemMoveResult = MoveResult[CardItemOut]


class ItemsCreated(BaseModel):
    """`POST /api/cards/{card_id}/items` with `split_lines`: one item per line (4.6)."""

    items: list[CardItemOut]
    board_version: int


class ItemCreateIn(BaseModel):
    """`POST /api/cards/{card_id}/items` (Sections 4.6 and 2.6.3).

    An absent `index` appends, which is what the "Add an item" composer sends. `split_lines` is
    the "Add N items" answer to a multi-line paste: one item per non-empty line, in order.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: ItemName
    index: ItemIndex | None = None
    split_lines: bool = False


class ItemUpdateIn(BaseModel):
    """`PATCH /api/card-items/{item_id}` (Section 4.6).

    An absent field is untouched (`exclude_unset`); `due_at: null` removes the due date, which
    is what the Remove button of `ItemDuePopover` sends. `name` and `is_checked` are the two
    fields `null` is never valid for.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: ItemName | None = None
    is_checked: bool | None = None
    due_at: IsoTimestamp | None = None

    @model_validator(mode="after")
    def _check_body(self) -> "ItemUpdateIn":
        nulled = sorted(
            field
            for field in ("name", "is_checked")
            if field in self.model_fields_set and getattr(self, field) is None
        )
        if nulled:
            raise ValueError(f"{', '.join(nulled)}: null is not allowed")
        if not self.model_fields_set:
            raise ValueError("Send at least one field to change")
        return self


class ItemMoveIn(MoveIn):
    """`POST /api/card-items/{item_id}/move` (Sections 4.6 and 4.9).

    `MoveIn` carries the required 0-based `index` and the optional neighbour ids, and that is the
    whole body: an item's only container is its card, so a move names no destination. The modal's
    drag sends `index` alone.
    """

    model_config = ConfigDict(extra="forbid")
