"""Checklist and checklist-item shapes (Section 4.6, with the `ChecklistOut` listing of 4.6).

`Mutated`, `MoveResult` and the single move body `MoveIn` are declared once for the whole API in
`schemas/common.py` (Sections 4.1 and 4.9); this module imports them and adds only what a
checklist needs. `CardBadges` comes from `schemas/common.py` because the item patch answers with
the card's recomputed badges - the very same object `CardSummary.badges` carries - so the tile
can patch `checklist_done` / `checklist_total` without refetching the board (Section 4.6); it
is shared rather than owned by `schemas/cards.py`, which embeds `ChecklistOut` in `CardDetail`.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from kanban.schemas.common import (
    CardBadges,
    IsoTimestamp,
    MoveIn,
    MoveResult,
    Mutated,
)

#: `checklists.name`: 1-512 characters, the `name` limit of Section 4.1.
ChecklistName = Annotated[str, StringConstraints(min_length=1, max_length=512)]

#: `checklist_items.name`: 1-16384, the same limit as a card title (Section 4.1). A `split_lines`
#: paste is validated as one body and split per line by the service.
ItemName = Annotated[str, StringConstraints(min_length=1, max_length=16384)]

#: Any row id a body may carry.
RowId = Annotated[int, Field(ge=1)]

#: A 0-based slot over the destination container's items (Section 3.6); absent appends.
ItemIndex = Annotated[int, Field(ge=0)]

#: "Convert to card" places the new card in the item's own list; `bottom` and an absent value
#: both append, which is what the item's three-dots menu sends (Sections 4.6 and 2.6.3).
ConvertIndex = ItemIndex | Literal["bottom"]

#: The default a checklist is created with when the popover's Title input is left alone
#: (Sections 4.6 and 2.6.5); it is also the `checklists.name` DDL default.
DEFAULT_CHECKLIST_NAME = "Checklist"


class ChecklistItemOut(BaseModel):
    """One row of a checklist, as Section 4.6 types it."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    checklist_id: int
    name: str
    position: float
    is_checked: bool
    checked_at: str | None
    due_at: str | None


class ChecklistItemPatchedOut(ChecklistItemOut):
    """`PATCH /api/checklist-items/{item_id}`: the item plus the card's recomputed badges.

    Section 4.6 types the response as `ChecklistItemOut & {badges}` so ticking an item updates
    the tile's `checklist_done / checklist_total` from the same round trip.
    """

    badges: CardBadges


class ChecklistOut(BaseModel):
    """A checklist with its items in `position` order (Section 4.6)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    card_id: int
    name: str
    position: float
    items: list[ChecklistItemOut]


class BoardChecklistOut(BaseModel):
    """One row of `GET /api/boards/{board_id}/checklists` (Section 4.6).

    What the "Copy items from…" select of `ChecklistPopover` renders as "Card title / Checklist
    name", with the item count beside it.
    """

    id: int
    name: str
    card_id: int
    card_title: str
    item_count: int


class BoardChecklistsOut(BaseModel):
    """`GET /api/boards/{board_id}/checklists` (Section 4.6)."""

    items: list[BoardChecklistOut]


#: The wrappers of Sections 4.1 and 4.9, parametrised once for checklists and their items.
ChecklistMutated = Mutated[ChecklistOut]
ChecklistMoveResult = MoveResult[ChecklistOut]
ItemMutated = Mutated[ChecklistItemOut]
ItemPatched = Mutated[ChecklistItemPatchedOut]
ItemMoveResult = MoveResult[ChecklistItemOut]


class ItemsCreated(BaseModel):
    """`POST /api/checklists/{checklist_id}/items` with `split_lines`: one item per line (4.6)."""

    items: list[ChecklistItemOut]
    board_version: int


class ChecklistCreateIn(BaseModel):
    """`POST /api/cards/{card_id}/checklists` (Sections 4.6 and 2.6.5).

    `copy_from_checklist_id` is the "Copy items from…" select: its items are copied unchecked,
    and a source on another board is a 400.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: ChecklistName = DEFAULT_CHECKLIST_NAME
    copy_from_checklist_id: RowId | None = None


class ChecklistUpdateIn(BaseModel):
    """`PATCH /api/checklists/{checklist_id}`: the inline rename of the section header (4.6)."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: ChecklistName | None = None

    @model_validator(mode="after")
    def _check_body(self) -> "ChecklistUpdateIn":
        if not self.model_fields_set:
            raise ValueError("Send at least one field to change")
        if self.name is None:
            raise ValueError("name: null is not allowed")
        return self


class ItemCreateIn(BaseModel):
    """`POST /api/checklists/{checklist_id}/items` (Sections 4.6 and 2.6.3).

    An absent `index` appends, which is what the "Add an item" composer sends. `split_lines` is
    the "Add N items" answer to a multi-line paste: one item per non-empty line, in order.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: ItemName
    index: ItemIndex | None = None
    split_lines: bool = False


class ItemUpdateIn(BaseModel):
    """`PATCH /api/checklist-items/{item_id}` (Section 4.6).

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
    """`POST /api/checklist-items/{item_id}/move` (Sections 4.6 and 4.9).

    `MoveIn` carries the required 0-based `index` and the optional neighbour ids; an item adds
    the destination checklist, which must belong to the same card (400 `bad_request` otherwise).
    The modal's drag sends `to_checklist_id` and `index` only.
    """

    model_config = ConfigDict(extra="forbid")

    to_checklist_id: RowId


class ItemConvertIn(BaseModel):
    """`POST /api/checklist-items/{item_id}/convert` (Section 4.6): "Convert to card"."""

    model_config = ConfigDict(extra="forbid")

    index: ConvertIndex | None = None
