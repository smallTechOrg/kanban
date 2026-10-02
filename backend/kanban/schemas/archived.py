"""`GET /api/boards/{board_id}/archived`: the two pages the Archived Items panel reads (4.3).

Section 4.3 types the response as `{items: CardSummary[] or ListOut[], next_before}` - one path
whose `type` query parameter decides which row shape comes back. The two shapes are declared as two
models rather than one with a union field so the generated client (and the OpenAPI document behind
`api/types.ts`) keeps `items` typed per `type` instead of leaving the caller to narrow it.

They live in a module of their own because neither domain owns them: `CardSummary` comes from
`schemas/cards.py`, `ListOut` from `schemas/lists.py`, and putting the pair in either file would
make that module import the other for one endpoint that is really a board-level read.
"""

from pydantic import BaseModel

from kanban.schemas.cards import CardSummary
from kanban.schemas.lists import ListOut


class ArchivedCardsPage(BaseModel):
    """`?type=cards`: the board's archived cards, newest first (Section 4.3).

    `next_before` is the `cards.id` of the last row of a full page, and `null` once the panel has
    reached the end, which is the cursor contract of Section 4.1.
    """

    items: list[CardSummary]
    next_before: int | None = None


class ArchivedListsPage(BaseModel):
    """`?type=lists`: the board's archived lists, newest first, with the same cursor."""

    items: list[ListOut]
    next_before: int | None = None
