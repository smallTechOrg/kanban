"""Card request and response shapes (Sections 4.4, 4.5, 4.9 and 4.10.1).

`Mutated`, `MoveResult` and the single move body `MoveIn` are declared once for the whole API in
`schemas/common.py`; this module imports them and adds only what a card needs, so the two
wrappers a card endpoint answers with (`CardMutated`, `CardMoveResult`) are written down here
once instead of being re-parametrised in the router.
"""

from typing import Annotated, ClassVar, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from kanban.schemas.common import (
    CardBadges,
    IsoTimestamp,
    MoveIn,
    MoveResult,
    Mutated,
    OptionalFieldsOmitted,
)
from kanban.schemas.items import CardItemOut

#: Length limit from Section 4.1: a card title is 1-16384 characters.
CardTitle = Annotated[str, StringConstraints(min_length=1, max_length=16384)]

#: Length limit from Section 4.1: a description is 0-16384 characters of Markdown.
CardDescription = Annotated[str, StringConstraints(max_length=16384)]

#: The nine `DatesPopover` reminder offsets in minutes before the due date, `0` being "At time of
#: due date" and `None` "None" (Section 2.6.5; the same closed list as the `cards` DDL comment).
DueReminderMinutes = Literal[0, 5, 10, 15, 60, 120, 1440, 2880]

#: `cards.client_id`: the optimistic id `CardComposer` mints (Sections 2.4.4 and 4.4).
CLIENT_ID_PATTERN = r"^tmp_[A-Za-z0-9]{1,32}$"
ClientId = Annotated[str, StringConstraints(pattern=CLIENT_ID_PATTERN)]

#: Any row id a body may carry.
RowId = Annotated[int, Field(ge=1)]

#: A create `index`: a 0-based slot over the list's active cards, or Trello's `top` / `bottom`
#: (Section 4.4). A move `index` is always a number and comes from `MoveIn`.
CardIndex = Annotated[int, Field(ge=0)] | Literal["top", "bottom"]


class CardSummary(OptionalFieldsOmitted):
    """A card as every card response and the board payload carry it (Section 4.10.1).

    `client_id` is echoed for the row's lifetime so `CardTile` can key on `client_id ?? id`
    without remounting on the optimistic id swap (Section 4.4); it is omitted, not `null`, for
    the cards that were never created through a composer.

    `items` is the whole array, not a count: Section 2.5.1 lists a card's items on its tile,
    with the ticks the modal shows and in the same `position` order, so the two surfaces render
    one shape. `badges.item_done` / `item_total` stay beside it because the badge row states the
    progress in a glance; both follow from this array and are built from it.
    """

    optional_fields = ("client_id",)

    id: int
    client_id: str | None = None
    board_id: int
    list_id: int
    short_id: int
    title: str
    position: float
    is_archived: bool
    start_at: str | None
    due_at: str | None
    due_complete: bool
    label_ids: list[int]
    items: list[CardItemOut]
    badges: CardBadges
    created_at: str
    updated_at: str


class CardDetail(CardSummary):
    """`GET /api/cards/{card_id}`: the whole card the modal renders (Sections 4.5 and 2.6).

    Section 4.5 defines it as `CardSummary` plus the fields no tile needs, which is exactly what
    subclassing expresses: the modal reads one document instead of stitching the board payload's
    summary together with four more requests. `label_ids` is inherited rather than expanded into
    label objects, because the board payload already cached every label of the board and a second
    copy here would be a second source of truth.

    `board_name` is what `CardModalHeader` shows and `list_name` is the "in list To Do" sub-line
    (Section 2.6.2); both are the current names, not the denormalised ones of `activities.data`,
    because this is live state rather than history.

    `items` is inherited: `ItemsSection` (Section 2.6.3) and the tile (Section 2.5.1) render the
    same array, so the modal adds nothing to it.
    """

    description: str
    due_reminder_minutes: int | None
    board_name: str
    list_name: str


#: The two wrappers of Sections 4.1 and 4.9, parametrised once for cards.
CardMutated = Mutated[CardSummary]
CardMoveResult = MoveResult[CardSummary]


class CardsCreated(BaseModel):
    """`POST /api/lists/{list_id}/cards` with `split_lines`: one card per pasted line (4.4)."""

    items: list[CardSummary]
    board_version: int


class CardCreateIn(BaseModel):
    """`POST /api/lists/{list_id}/cards` (Section 4.4).

    `index` omitted or `"bottom"` appends; `"top"` inserts in front; a number is the 0-based slot
    over the list's active cards (the composer's 1-based `^N` is mapped to `N - 1` client-side,
    Section 2.4.4). `label_ids` is what the `#label` tokens parse to. `split_lines` turns a
    multi-line paste into one card per non-empty line, in order.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: CardTitle
    index: CardIndex | None = None
    client_id: ClientId | None = None
    label_ids: list[RowId] = Field(default_factory=list)
    split_lines: bool = False


class CardUpdateIn(BaseModel):
    """`PATCH /api/cards/{card_id}` (Section 4.5): every scalar field of a card.

    An absent field is untouched (`exclude_unset`) and an explicit `null` clears the field, but
    only for the three nullable columns (Section 4.1): the `DatesPopover` "Remove" button sends
    `{"start_at": null, "due_at": null, "due_reminder_minutes": null}` and nothing else may be
    nulled. Archiving and moving have their own routes, and `PATCH` never accepts `is_archived`
    (Section 3.7).
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    #: The columns an explicit `null` may clear; `None` on any other field is a 422.
    NULLABLE_FIELDS: ClassVar[frozenset[str]] = frozenset(
        {"start_at", "due_at", "due_reminder_minutes"}
    )

    title: CardTitle | None = None
    description: CardDescription | None = None
    start_at: IsoTimestamp | None = None
    due_at: IsoTimestamp | None = None
    due_complete: bool | None = None
    due_reminder_minutes: DueReminderMinutes | None = None

    @model_validator(mode="after")
    def _check_body(self) -> "CardUpdateIn":
        nulled = sorted(
            field
            for field in self.model_fields_set
            if getattr(self, field) is None and field not in self.NULLABLE_FIELDS
        )
        if nulled:
            raise ValueError(f"{', '.join(nulled)}: null is not allowed")
        return self


class CardMoveIn(MoveIn):
    """`POST /api/cards/{card_id}/move` (Sections 4.5 and 4.9).

    `MoveIn` carries the required 0-based `index` and the optional neighbour ids that only
    `onDragEnd` sends; a card adds the destination list. Neighbours take precedence over `index`
    exactly as `ordering.place_in_container` implements it.

    The destination is a list of the board the route already resolved: a card never changes board
    (only a whole list does, Section 3.6), so there is no `to_board_id` and no body field naming a
    board the access dependency has not already checked.
    """

    model_config = ConfigDict(extra="forbid")

    to_list_id: RowId
