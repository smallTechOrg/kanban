"""`GET /api/search` response shapes (Section 4.7).

Section 4.7 types the response as `{boards: BoardSummary[], cards: SearchCard[]}` and says in so
many words that `SearchCard` is deliberately **not** a `CardSummary`: the FTS5 SELECT of Section
3.4 produces exactly the seven columns below plus one labels query, and `SearchPopover` needs
nothing else - no badges and no cover. Building a full `CardSummary` here
would mean either the board payload's badge sub-selects per hit or a second query per row.

`SearchBoard` is `BoardSummary` under the name the search domain calls it by, not a second model:
the board rows come from `services.boards.board_summary()`, the one place a `boards` row becomes
that shape (CLAUDE.md section 3), so declaring a narrower board model here would be a second copy
of a shape the client already has typed.
"""

from pydantic import BaseModel

from kanban.schemas.boards import BoardSummary
from kanban.schemas.labels import LabelColor, LabelTone

#: A board row of the search response. Section 4.7 names the field `boards: BoardSummary[]`; the
#: alias exists so this module reads as the search contract without restating the shape.
SearchBoard = BoardSummary


class SearchCardLabel(BaseModel):
    """One resolved label chip of a search hit (Section 4.7).

    The label travels with the row rather than as an id: a hit may belong to a board other than
    the open one, whose `labels` array is in no client cache, and `SearchPopover` still has to
    paint the 8px chips. `color` and `tone` are the palette types of `schemas/labels.py`, so the
    ten colour keys are not written down a second time.
    """

    color: LabelColor
    tone: LabelTone
    name: str


class SearchCard(BaseModel):
    """One card hit (Section 4.7), ranked by `bm25(cards_fts)` and rendered as a popover row.

    `board_name` and `list_name` are the denormalised names behind the muted "in Board - List"
    line; `id` and `board_id` are what the row navigates to (`/b/:boardId/c/:cardId`).
    """

    id: int
    short_id: int
    title: str
    board_id: int
    list_id: int
    board_name: str
    list_name: str
    labels: list[SearchCardLabel]


class SearchResults(BaseModel):
    """`GET /api/search?q=`: the two groups `SearchPopover` renders, boards first (2.1.1)."""

    boards: list[SearchBoard]
    cards: list[SearchCard]
