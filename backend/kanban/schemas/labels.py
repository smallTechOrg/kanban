"""Label request and response shapes (Sections 4.3 and 4.5).

Section 4.3 declares `LabelOut` in the same TypeScript block as `BoardSummary`, and `schemas/
boards.py` held it until the label router arrived. The shape belongs to the label domain, so it
lives here now and `schemas/boards.py` imports it for the `labels` array of the board document -
one definition, not two (CLAUDE.md section 3). `LabelOut` reads straight off a `labels` row
(`from_attributes`), which is what every label mutation hands its router.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

from kanban.constants import LABEL_COLORS

#: Length limit from Section 4.1. A label name may be empty: the six seeded ones are (Section 3.10).
LabelName = Annotated[str, StringConstraints(max_length=512)]

#: The ten palette keys of Section 2.9.2 plus `none` ("Remove color"), read from the single copy
#: of the palette in `constants.py` so no colour name is written down twice.
LabelColor = Literal[tuple(LABEL_COLORS)]  # type: ignore[valid-type]
LabelTone = Literal["subtle", "normal", "bold"]

#: The tone a label is created with when the body omits it (Section 4.3).
DEFAULT_LABEL_TONE: LabelTone = "normal"


class LabelOut(BaseModel):
    """A board label (Section 4.3); `name` may be empty, as the six seeded labels are."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    board_id: int
    name: str
    color: LabelColor
    tone: LabelTone
    position: float


class LabelsOut(BaseModel):
    """`GET /api/boards/{board_id}/labels`, ordered by `position` (Section 4.3)."""

    items: list[LabelOut]


class LabelCreateIn(BaseModel):
    """`POST /api/boards/{board_id}/labels` (Section 4.3).

    `color` is the only required field; the label is appended at `max(position) + 65536`, which
    the service takes from `ordering.py` rather than computing here.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: LabelName = ""
    color: LabelColor
    tone: LabelTone = DEFAULT_LABEL_TONE


class LabelUpdateIn(BaseModel):
    """`PATCH /api/labels/{label_id}` (Section 4.3).

    An absent field is untouched (`exclude_unset`); no field is nullable, so an explicit `null`
    is a 422 - "Remove color" sends the `none` palette key, not `null`  (Section 2.6.5).
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: LabelName | None = None
    color: LabelColor | None = None
    tone: LabelTone | None = None

    @model_validator(mode="after")
    def _check_body(self) -> "LabelUpdateIn":
        nulled = sorted(field for field in self.model_fields_set if getattr(self, field) is None)
        if nulled:
            raise ValueError(f"{', '.join(nulled)}: null is not allowed")
        return self


class CardLabelsOut(BaseModel):
    """`PUT` / `DELETE /api/cards/{card_id}/labels/{label_id}` (Section 4.5).

    Deliberately not a `Mutated[LabelOut]`: the card's whole label id list comes back, in the
    `position` order the chips row renders, so the client patches one array into its cache.
    """

    label_ids: list[int]
    board_version: int
