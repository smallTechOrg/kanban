"""List shapes: the column itself and the bulk card operations of its menu (Section 4.4).

`Mutated` and `MoveResult` are declared once for the whole API in `schemas/common.py` (Sections
4.1 and 4.9) and imported by the router from there; the one thing this module adds to the move
contract is `ListMoveIn`, which is `MoveIn` plus the `to_board_id?` Section 4.9 lists for it. The
list colour keys come from `constants.LIST_COLORS`, which is also what `GET /api/meta` publishes,
so the ten names are written down once.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from kanban.constants import LIST_COLORS
from kanban.schemas.common import MoveIn

#: `lists.name`, with the Section 4.1 length limit that `ck_lists_name_length` also enforces.
ListName = Annotated[str, StringConstraints(min_length=1, max_length=512)]

#: One of the ten list colour keys, or `null` for no colour (Section 4.4).
ListColor = Literal[tuple(LIST_COLORS)]  # type: ignore[valid-type]

#: How `POST /api/lists/{list_id}/unarchive-cards` is bounded (Section 4.4).
UNARCHIVE_CARDS_LIMIT = 500

#: The four orders "Sort list" offers (Section 2.4.3): `title` is by card name.
SortBy = Literal["created_desc", "created_asc", "title", "due"]


class ListOut(BaseModel):
    """A list column as every list mutation and the board payload return it (Section 4.4)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    board_id: int
    name: str
    position: float
    color: ListColor | None
    is_archived: bool
    created_at: str
    updated_at: str


class ListMoveIn(MoveIn):
    """`POST /api/lists/{list_id}/move` (Sections 4.4 and 4.9).

    `MoveIn` carries the 0-based `index` and the neighbour ids `onDragEnd` sends; a list adds the
    destination board, which is the "Move list to another board" sub-view of Section 2.4.3. A
    `to_board_id` naming another board hands the column and every one of its cards over in one
    transaction spanning both boards (`services.lists.move_list`); the caller's right to write
    there is checked by `services.cards.target_board`, because the id is in the body and no path
    dependency ever sees it.
    """

    model_config = ConfigDict(extra="forbid")

    to_board_id: Annotated[int, Field(ge=1)] | None = None


class ListWithCountOut(ListOut):
    """A row of `GET /api/boards/{board_id}/lists`: a list plus its active card count."""

    card_count: int


class ListsOut(BaseModel):
    """`GET /api/boards/{board_id}/lists` (Section 4.4)."""

    items: list[ListWithCountOut]


class ListCreateIn(BaseModel):
    """`POST /api/boards/{board_id}/lists`; an absent `index` appends (Section 4.4)."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: ListName
    index: int | None = Field(default=None, ge=0)


class ListUpdateIn(BaseModel):
    """`PATCH /api/lists/{list_id}`: rename, recolour or both (Section 4.4).

    An absent field is untouched (`exclude_unset`). `color` is the one nullable field of the
    body, because `null` is how the "Remove colour" item of the list menu clears it.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: ListName | None = None
    color: ListColor | None = None

    @model_validator(mode="after")
    def _check_body(self) -> "ListUpdateIn":
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name: null is not allowed")
        if not self.model_fields_set:
            raise ValueError("send at least one of name, color")
        return self


class ListCopyIn(BaseModel):
    """`POST /api/lists/{list_id}/copy`; an absent `index` lands after the source (Section 4.4)."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: ListName
    index: int | None = Field(default=None, ge=0)


class ListSortIn(BaseModel):
    """`POST /api/lists/{list_id}/sort` (Section 4.4). `due` sorts cards without a due date last."""

    model_config = ConfigDict(extra="forbid")

    by: SortBy


class MoveAllCardsIn(BaseModel):
    """`POST /api/lists/{list_id}/move-all-cards`: same board only (Section 4.4)."""

    model_config = ConfigDict(extra="forbid")

    to_list_id: int = Field(ge=1)


class UnarchiveCardsIn(BaseModel):
    """`POST /api/lists/{list_id}/unarchive-cards`: the Undo of "Archive all cards" (4.4)."""

    model_config = ConfigDict(extra="forbid")

    card_ids: list[int] = Field(min_length=1, max_length=UNARCHIVE_CARDS_LIMIT)


class ArchiveAllCardsOut(BaseModel):
    """`POST /api/lists/{list_id}/archive-all-cards`.

    `archived_ids` is in `position` order and feeds the Undo toast, which hands it straight back
    to `/unarchive-cards` (Section 4.4).
    """

    archived: int
    archived_ids: list[int]
    board_version: int


class UnarchiveCardsOut(BaseModel):
    """`POST /api/lists/{list_id}/unarchive-cards`: how many of the ids were restored."""

    restored: int
    board_version: int


class PositionsOut(BaseModel):
    """The response of the two endpoints that renumber a whole list (Section 4.4).

    `positions` maps card id to its new `position` for every card the renumbering touched, which
    is what the client writes into its cache instead of refetching the board.
    """

    positions: dict[int, float]
    board_version: int


class MoveAllCardsOut(PositionsOut):
    """`POST /api/lists/{list_id}/move-all-cards`: `PositionsOut` plus how many cards moved."""

    moved: int
