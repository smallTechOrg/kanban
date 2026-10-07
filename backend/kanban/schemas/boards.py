"""Board and background shapes (Sections 4.3, 4.10.1 and 2.2).

Section 4.3 declares `BoardSummary` and `LabelOut` in one TypeScript block and both lived here
until the label router arrived; `LabelOut` now belongs to `schemas/labels.py` with the rest of the
label domain and is imported here for the `labels` array of the board document (CLAUDE.md 3).
"""

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from kanban.constants import BOARD_GRADIENTS, DEFAULT_BOARD_COLOR
from kanban.schemas.cards import CardSummary
from kanban.schemas.labels import LabelOut
from kanban.schemas.lists import ListOut

#: `boards.background_value` for a `color` background (Section 4.3).
HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")

#: Length limits from Section 4.1.
BoardName = Annotated[str, StringConstraints(min_length=1, max_length=512)]
BoardDescription = Annotated[str, StringConstraints(max_length=16384)]

BackgroundType = Literal["color", "gradient", "image"]
#: `image` backgrounds are only ever set through the upload route or `background_image_id`.
PresetBackgroundType = Literal["color", "gradient"]


def validated_background(background_type: str, background_value: str) -> str:
    """Check `background_value` against its `background_type` (Section 4.3).

    A `color` is a six-digit hex; a `gradient` is a key of `constants.BOARD_GRADIENTS`, which is
    also what `GET /api/meta` publishes. Raises `ValueError`, which Pydantic renders as a 422.
    """
    if background_type == "color" and not HEX_COLOR_PATTERN.match(background_value):
        raise ValueError(
            "background_value must be a hex colour like #0079BF for background_type=color"
        )
    if background_type == "gradient" and background_value not in BOARD_GRADIENTS:
        raise ValueError(
            "background_value must be one of "
            f"{', '.join(BOARD_GRADIENTS)} for background_type=gradient"
        )
    return background_value


class BoardSummary(BaseModel):
    """A board as the home page, the board page and every board mutation return it (Section 4.3)."""

    id: int
    name: str
    description: str
    background_type: BackgroundType
    background_value: str
    #: The 400x240 `/uploads/backgrounds/{id}.thumb.jpg` for `image` backgrounds, else `null`.
    background_thumb_url: str | None
    is_closed: bool
    version: int
    created_at: str
    updated_at: str


class BoardGroups(BaseModel):
    """`GET /api/boards` with the default `closed=0` (Section 2.2).

    One flat list: `all` is every open board alphabetically (`COLLATE NOCASE`). The home page
    shows exactly this, with no starred or recently-viewed group above it.
    """

    all: list[BoardSummary]


class ClosedBoardGroup(BaseModel):
    """`GET /api/boards?closed=1`, the rows of `ClosedBoardsModal` (Section 2.2)."""

    closed: list[BoardSummary]


class BoardOut(BaseModel):
    """`GET /api/boards/{board_id}`: the `BoardPayload` of Section 4.10.1.

    The whole document in one round trip: the board, its labels, and every *active* list and card
    of the board. `board_payload.py` assembles it; the arrays here are the only shape the board
    page reads.
    """

    board: BoardSummary
    labels: list[LabelOut]
    lists: list[ListOut] = Field(default_factory=list)
    cards: list[CardSummary] = Field(default_factory=list)


class BoardCreateIn(BaseModel):
    """`POST /api/boards` (Section 4.3). `default_lists` seeds To Do / Doing / Done."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: BoardName
    background_type: PresetBackgroundType = "color"
    background_value: str = DEFAULT_BOARD_COLOR
    default_lists: bool = True

    @model_validator(mode="after")
    def _check_background(self) -> "BoardCreateIn":
        validated_background(self.background_type, self.background_value)
        return self


class BoardUpdateIn(BaseModel):
    """`PATCH /api/boards/{board_id}` (Section 4.3).

    An absent field is untouched (`exclude_unset`); no field of this body is nullable, so an
    explicit `null` is a 422. `background_type` and `background_value` travel together and
    cannot be combined with `background_image_id`, which re-selects an already uploaded image.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: BoardName | None = None
    description: BoardDescription | None = None
    background_type: PresetBackgroundType | None = None
    background_value: str | None = None
    background_image_id: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _check_body(self) -> "BoardUpdateIn":
        nulled = sorted(field for field in self.model_fields_set if getattr(self, field) is None)
        if nulled:
            raise ValueError(f"{', '.join(nulled)}: null is not allowed")
        preset = {"background_type", "background_value"} & self.model_fields_set
        if preset and "background_image_id" in self.model_fields_set:
            raise ValueError(
                "background_image_id cannot be combined with background_type / background_value"
            )
        if len(preset) == 1:
            raise ValueError("background_type and background_value must be sent together")
        if self.background_type is not None and self.background_value is not None:
            validated_background(self.background_type, self.background_value)
        return self


class BackgroundColorOut(BaseModel):
    """One solid preset of `constants.BOARD_COLORS`."""

    key: str
    hex: str


class BackgroundGradientOut(BaseModel):
    """One gradient preset of `constants.BOARD_GRADIENTS`."""

    key: str
    css: str


class CustomBackgroundOut(BaseModel):
    """One uploaded image from the `board_backgrounds` library."""

    id: int
    url: str
    thumb_url: str


class BoardBackgroundOut(BaseModel):
    """`GET /api/boards/{board_id}/backgrounds`: the presets plus the uploaded images."""

    colors: list[BackgroundColorOut]
    gradients: list[BackgroundGradientOut]
    custom: list[CustomBackgroundOut]
