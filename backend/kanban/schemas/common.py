"""Shapes shared by every resource: the error envelope, mutation wrappers and the move body.

Section 4.1 declares `Mutated<T>` and `MoveResult<T>` once for the whole API, and Section 4.9
declares one move body for all four move endpoints; both live here so no router restates them.
"""

from typing import Annotated, Any, ClassVar, Literal

from pydantic import BaseModel, Field, StringConstraints, model_serializer
from pydantic.functional_serializers import SerializerFunctionWrapHandler

#: An instant in the one format Section 4.1 defines for the whole API: ISO-8601 UTC with a `Z`
#: suffix, which is what `models.utcnow_iso()` writes and what `Date.prototype.toISOString()`
#: produces. Every body that carries a client-chosen instant - a card's `start_at` / `due_at`,
#: a card item's `due_at` - validates against this one type rather than its own copy, and
#: the value is stored exactly as received (the client converts from browser-local first).
ISO_UTC_PATTERN = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$"
IsoTimestamp = Annotated[str, StringConstraints(pattern=ISO_UTC_PATTERN)]


class ErrorBody(BaseModel):
    """The `error` object of the Section 4.1 envelope."""

    code: str
    message: str
    #: A Pydantic error list for 422, an object of context for an `ApiError`, `None` otherwise.
    details: list[dict[str, Any]] | dict[str, Any] | None = None
    request_id: str


class ErrorEnvelope(BaseModel):
    """The body of every non-2xx `/api` and `/uploads` response."""

    error: ErrorBody


class OptionalFieldsOmitted(BaseModel):
    """Serialise the fields named in `optional_fields` as *absent* rather than `null`.

    Section 4.5 types several response fields as `image_url?: string`, not `string | null`, and
    its JSON examples leave them out entirely; a Pydantic field with a `None` default would emit
    an explicit `null` instead. Subclasses list those field names and inherit this serializer, so
    the "optional means absent" rule is written down once for the whole API rather than once per
    model (CLAUDE.md section 3).
    """

    optional_fields: ClassVar[tuple[str, ...]] = ()

    @model_serializer(mode="wrap")
    def _omit_absent_optionals(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data: dict[str, Any] = handler(self)
        for name in self.optional_fields:
            if data.get(name) is None:
                data.pop(name, None)
        return data


class Mutated[T](BaseModel):
    """Every single-row mutating response inside a board (Section 4.1)."""

    item: T
    board_version: int


class MoveResult[T](Mutated[T]):
    """Every move response (Section 4.9).

    `positions` is empty unless the server had to renumber the container; when it is not, the
    client writes each listed position into its cache before re-sorting.
    """

    positions: dict[int, float] = Field(default_factory=dict)


class MoveIn(BaseModel):
    """The single move body (Section 4.9).

    `index` is required and 0-based over the ACTIVE siblings of the destination container.
    `prev_id` / `next_id` are the ids that will surround the moved row *after* the move; when
    present they take precedence over `index`, and `onDragEnd` is the only caller that sends them.
    """

    index: int = Field(ge=0)
    prev_id: int | None = None
    next_id: int | None = None


class CardBadges(BaseModel):
    """The three tile badge counts of Sections 2.5 and 4.10.1.

    It lives here rather than in `schemas/cards.py` because three domains answer with it: every
    `CardSummary`, the board payload, and the item patch of Section 4.6, whose response is
    `CardItemOut & {badges}` so the tile can be updated from the same round trip. With it beside
    the other shared shapes, `schemas/cards.py` can embed `CardItemOut` in `CardDetail` and
    `schemas/items.py` can embed these badges without the two importing each other.
    """

    description: bool
    item_done: int
    item_total: int


class Health(BaseModel):
    """`GET /api/health`, for reverse-proxy health checks (Section 4.7)."""

    status: Literal["ok"]
    db: Literal["ok"]
    version: str
    frontend_build: bool


class LabelColorOut(BaseModel):
    """One row of the label palette (Section 2.9.2)."""

    subtle: str
    normal: str
    bold: str
    text: str
    text_bold: str


class Meta(BaseModel):
    """`GET /api/meta`: the palettes the SPA reads at start-up."""

    version: str
    label_colors: dict[str, LabelColorOut]
    board_colors: dict[str, str]
    board_gradients: dict[str, str]
    list_colors: dict[str, str]
