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

from kanban.schemas.attachments import AttachmentOut
from kanban.schemas.checklists import ChecklistOut
from kanban.schemas.common import (
    CardBadges,
    CoverKind,
    CoverSize,
    IsoTimestamp,
    MoveIn,
    MoveResult,
    Mutated,
    OptionalFieldsOmitted,
)

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


class CardCover(OptionalFieldsOmitted):
    """`cards.cover_type` / `cover_value` / `cover_size` as the tile reads them (Section 4.10.1).

    `image_url` and `dominant_color` are only ever set for an `attachment` cover and come from the
    `attachments` row `value` names; a `color` cover carries the palette key in `value` and omits
    both, exactly as the Section 4.10.1 example does.
    """

    optional_fields = ("image_url", "dominant_color")

    kind: CoverKind
    value: str
    size: CoverSize
    image_url: str | None = None
    dominant_color: str | None = None


class CardSummary(OptionalFieldsOmitted):
    """A card as every card response and the board payload carry it (Section 4.10.1).

    `client_id` is echoed for the row's lifetime so `CardTile` can key on `client_id ?? id`
    without remounting on the optimistic id swap (Section 4.4); it is omitted, not `null`, for
    the cards that were never created through a composer.
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
    is_template: bool
    start_at: str | None
    due_at: str | None
    due_complete: bool
    cover: CardCover | None
    label_ids: list[int]
    member_ids: list[int]
    is_watching: bool
    badges: CardBadges
    created_at: str
    updated_at: str


class CardDetail(CardSummary):
    """`GET /api/cards/{card_id}`: the whole card the modal renders (Sections 4.5 and 2.6).

    Section 4.5 defines it as `CardSummary` plus the fields no tile needs, which is exactly what
    subclassing expresses: the modal reads one document instead of stitching the board payload's
    summary together with four more requests. `label_ids` and `member_ids` are inherited rather
    than expanded into label objects, because the board payload already cached every label and
    member of the board and a second copy here would be a second source of truth.

    `board_name` is what `CardModalHeader` and `SharePopover` show, and `list_name` is the
    "in list To Do" sub-line (Section 2.6.2); both are the current names, not the denormalised
    ones of `activities.data`, because this is live state rather than history.

    `attachments` is what `AttachmentsSection` renders and what the cover strip reads the original
    image out of (Sections 2.6.1 and 2.6.4); each row carries its own `is_cover`, so "Make cover" /
    "Remove cover" is decided from this list rather than by comparing ids in the component.
    """

    description: str
    due_reminder_minutes: int | None
    board_name: str
    list_name: str
    checklists: list[ChecklistOut]
    attachments: list[AttachmentOut]


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
    Section 2.4.4). `label_ids` / `member_ids` are what the `#label` / `@member` tokens parse to.
    `split_lines` turns a multi-line paste into one card per non-empty line, in order.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: CardTitle
    index: CardIndex | None = None
    client_id: ClientId | None = None
    label_ids: list[RowId] = Field(default_factory=list)
    member_ids: list[RowId] = Field(default_factory=list)
    split_lines: bool = False


class CardUpdateIn(BaseModel):
    """`PATCH /api/cards/{card_id}` (Section 4.5): every scalar field of a card.

    An absent field is untouched (`exclude_unset`) and an explicit `null` clears the field, but
    only for the three nullable columns (Section 4.1): the `DatesPopover` "Remove" button sends
    `{"start_at": null, "due_at": null, "due_reminder_minutes": null}` and nothing else may be
    nulled. Archiving, moving and covers have their own routes, and `PATCH` never accepts
    `is_archived` (Section 3.7).
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
    is_template: bool | None = None

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


class CardKeepIn(BaseModel):
    """The `keep` object of `POST /api/cards/{card_id}/copy` (Section 4.5).

    Every flag defaults to `false`, so a body that names none of them copies the card's own columns
    and nothing else; `CopyCardPopover` sends all five explicitly with its own defaults of `true`
    (Section 2.6.5). What each flag actually brings along is `kanban/copy.py`'s `Keep`, which this
    model is validated into by the router - the field names are the same five, so the two never
    drift, and a cross-board copy dropping labels and members stays a rule of that module.
    """

    model_config = ConfigDict(extra="forbid")

    labels: bool = False
    members: bool = False
    checklists: bool = False
    attachments: bool = False
    comments: bool = False


class CardCopyIn(BaseModel):
    """`POST /api/cards/{card_id}/copy` (Section 4.5).

    `to_list_id` may be a list of another board, which makes it a cross-board copy; an absent
    `index` appends. `title` is required, because the popover pre-fills it with the source title
    and lets the reader edit it.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: CardTitle
    to_list_id: RowId
    index: Annotated[int, Field(ge=0)] | None = None
    keep: CardKeepIn = Field(default_factory=lambda: CardKeepIn())
    is_template: bool | None = None


class CardMoveIn(MoveIn):
    """`POST /api/cards/{card_id}/move` (Sections 4.5 and 4.9).

    `MoveIn` carries the required 0-based `index` and the optional neighbour ids that only
    `onDragEnd` sends; a card adds the destination list and, for `MoveCardPopover`'s board select,
    the destination board. Neighbours take precedence over `index` exactly as
    `ordering.place_in_container` implements it.

    `to_board_id` equal to the card's own board is the ordinary same-board move; a different one is
    the cross-board hand-over of Section 3.6, which `services.cards.move_card` runs as one
    transaction over both boards. Whether the caller may write to it is not a shape but a rule, so
    `services.cards.target_board` decides it (403 for a board they are not a member of, and for one
    that does not exist, so ids cannot be enumerated).
    """

    model_config = ConfigDict(extra="forbid")

    to_list_id: RowId
    to_board_id: RowId | None = None
