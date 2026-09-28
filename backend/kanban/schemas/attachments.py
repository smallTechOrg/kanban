"""Attachments and card covers (Sections 4.5, 4.6 and 6.9).

`CoverIn` lives here rather than in `schemas/cards.py` because a cover's `value` is usually an
attachment: `PUT /api/cards/{card_id}/cover` is the one request that ties the two aggregates
together, and its response (`Mutated[CardSummary]`) is assembled by the router from
`schemas/cards.py`. Keeping the request body on this side is what makes the one import direction
work: `CardDetail` embeds `AttachmentOut` (Section 4.5), so this module may never import
`schemas/cards.py`, and the two cover literals both sides need live in `schemas/common.py` beside
`CardBadges` for exactly that reason.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator

from kanban.schemas.common import CoverKind, CoverSize, Mutated

#: Section 4.1's length limit for an attachment `name`, shared by the link form and the rename.
AttachmentName = Annotated[str, StringConstraints(min_length=1, max_length=512)]

#: A link attachment's target (Section 4.6): `http(s)` only, so a `javascript:` or `file:` URL can
#: never reach the anchor `AttachmentsSection` renders (Section 2.6.4).
LINK_URL_PATTERN = r"^https?://[^\s<>\"]+$"
LinkUrl = Annotated[str, StringConstraints(pattern=LINK_URL_PATTERN, max_length=2048)]


class AttachmentOut(BaseModel):
    """One `attachments` row as Section 4.6 defines it.

    `url` is the external link for a `link` row and `/uploads/attachments/{id}/{safe_name}` for an
    `upload`; `thumb_url` is the 2:1 thumbnail the 112x80 row and the card cover are painted from
    (Sections 2.6.4 and 2.5.1), `None` for anything without one. `is_cover` is derived from the
    card, not stored: `cards.cover_type = 'attachment'` with this row's id in `cover_value`, which
    is what makes the row's action read "Remove cover" rather than "Make cover".
    """

    id: int
    card_id: int
    user_id: int | None
    name: str
    kind: Literal["upload", "link"]
    url: str
    mime_type: str | None
    size_bytes: int | None
    is_image: bool
    thumb_url: str | None
    dominant_color: str | None
    is_cover: bool
    created_at: str


#: The wrapper of Section 4.1, parametrised once for attachments.
AttachmentMutated = Mutated[AttachmentOut]


class AttachmentCreateIn(BaseModel):
    """The JSON half of `POST /api/cards/{card_id}/attachments`: a link (Section 4.6).

    The multipart half carries no JSON body at all, so the content type is what picks the branch
    (`routers/attachments.py`); this model is the schema the OpenAPI document advertises for
    `application/json`. `name` defaults to the URL's host, which the service fills in - a default
    computed from another field is a rule, not a shape.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    url: LinkUrl
    name: AttachmentName | None = None


class AttachmentUpdateIn(BaseModel):
    """`PATCH /api/attachments/{attachment_id}`: the display name only (Section 4.6).

    Renaming never touches the file on disk, so `url`, `file_path` and `safe_name` are unchanged
    and every link already handed out keeps working.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: AttachmentName


class CoverIn(BaseModel):
    """`PUT /api/cards/{card_id}/cover` (Section 4.5).

    `value` is a `constants.COVER_COLORS` key for `kind="color"` and an attachment id of this card
    for `kind="attachment"`; which of the two it must be is checked in `services/attachments.py`,
    because it is a rule about the card's own rows rather than a shape. It is typed as text
    because `cards.cover_value` is one TEXT column for both, and an id arriving as the JSON number
    Section 4.1 mandates is accepted as that column's text.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    kind: CoverKind
    value: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    size: CoverSize = "normal"

    @field_validator("value", mode="before")
    @classmethod
    def _id_as_text(cls, value: Any) -> Any:
        """Accept an attachment id sent as a JSON number, which Section 4.1 says ids are."""
        return str(value) if isinstance(value, int) and not isinstance(value, bool) else value
