"""`GET /api/search`: the FTS5 query behind `SearchPopover` (Sections 2.1.1, 3.4, 4.7 and 6.7).

Three statements answer the whole popover, whatever the install holds: the open boards whose
name contains the typed text, the ranked card hits from `cards_fts`, and one query that resolves
the label chips of those hits. Nothing here iterates a result set into further queries.

Raw SQL lives in this module by design (CLAUDE.md section 2): the cards statement is the one in
Sections 3.4 and 6.7, run verbatim, because `MATCH` and `bm25()` are FTS5 syntax SQLAlchemy cannot
express. `cards_fts` itself and the three triggers that keep it in sync with `cards.title` /
`cards.description` belong to `0001_initial` (Section 3.9); this module only reads them.

**The user's text never reaches FTS5.** `_match_expression()` keeps only alphanumeric runs - the
same token shape `tokenize='unicode61'` indexes - and rebuilds each one as a quoted prefix term
(`"launch"*`), so a double quote, a `*`, a `^`, a `-`, `NEAR(`, `AND` / `OR` / `NOT` or an
unbalanced bracket is searched for as text or dropped instead of being parsed as an operator (an
FTS5 syntax error is a 500, and a bare `OR` would silently widen somebody's search).

Archived cards, cards inside an archived list and closed boards are excluded, which is the same
visibility rule as the board payload (Sections 3.7 and 4.3): the popover offers what can be
opened, so a hit that would land on `ClosedBoardPage` or on an archived card is not offered.
"""

import re
from collections import defaultdict
from typing import Any, Final

from sqlalchemy import collate, select, text
from sqlalchemy.orm import Session

from kanban.models import Board, CardLabel, Label
from kanban.services.boards import board_summary

#: `GET /api/search?limit=` (Section 4.7) and the ceiling the router validates against.
DEFAULT_SEARCH_LIMIT: Final[int] = 20
MAX_SEARCH_LIMIT: Final[int] = 50

#: `q` is at most this long (Section 4.7); longer is a 422 from the router.
MAX_QUERY_LENGTH: Final[int] = 200

#: How many terms of `q` are searched for. Every term is an AND'ed prefix scan, so a pasted
#: paragraph would otherwise cost one index walk per word for a query that can match nothing.
MAX_TERMS: Final[int] = 10

#: One indexable token: a run of letters or digits. `_` is a separator for `unicode61`, so it is
#: one here too, and everything else the user typed is punctuation to the tokenizer either way.
_TERM_PATTERN: Final[re.Pattern[str]] = re.compile(r"[^\W_]+")

#: Statement 2, verbatim from Sections 3.4 and 6.7. `rank` is `bm25(cards_fts)`, which is negative
#: and smaller the better the match, so plain `ORDER BY rank` is best-first.
_CARDS_SQL: Final[str] = """
SELECT c.id, c.short_id, c.title, c.board_id, c.list_id,
       b.name AS board_name, l.name AS list_name, bm25(cards_fts) AS rank
  FROM cards_fts
  JOIN cards c ON c.id = cards_fts.rowid
  JOIN lists l ON l.id = c.list_id
  JOIN boards b ON b.id = c.board_id
 WHERE cards_fts MATCH :q
   AND c.is_archived = 0
   AND l.is_archived = 0
   AND b.is_closed = 0{board_filter}
 ORDER BY rank
 LIMIT :limit
"""

#: The `board_id?` of Section 4.7, appended so the documented statement runs unchanged without it.
_BOARD_FILTER_SQL: Final[str] = "\n   AND c.board_id = :board_id"


def search(
    db: Session,
    *,
    q: str,
    board_id: int | None = None,
    limit: int = DEFAULT_SEARCH_LIMIT,
) -> dict[str, Any]:
    """The `{boards, cards}` of Section 4.7 for `q`.

    Boards match `name LIKE '%q%' COLLATE NOCASE` over the open boards; cards match `cards_fts`
    as prefix terms, ranked by `bm25`. `board_id` narrows both groups to that one board. Raises
    nothing: a query with no indexable term (empty, whitespace or punctuation only) is not an
    error but an empty result, because `SearchPopover` sends whatever has been typed so far and an
    error envelope is not a state it renders (Section 2.10).
    """
    typed = q.strip()
    if not typed:
        return {"boards": [], "cards": []}
    return {
        "boards": _boards(db, q=typed, board_id=board_id, limit=limit),
        "cards": _cards(db, q=typed, board_id=board_id, limit=limit),
    }


def _boards(db: Session, *, q: str, board_id: int | None, limit: int) -> list[dict[str, Any]]:
    """Statement 1: the open boards whose name contains `q`, alphabetically.

    `board_summary()` builds the rows, so the `BoardSummary` of the search response is the same
    shape the home page and the board page read.
    """
    statement = (
        select(Board)
        .where(
            Board.is_closed == 0,
            collate(Board.name, "NOCASE").contains(q, autoescape=True),
        )
        .order_by(collate(Board.name, "NOCASE"), Board.id)
        .limit(limit)
    )
    if board_id is not None:
        statement = statement.where(Board.id == board_id)
    return [board_summary(board) for board in db.execute(statement).scalars()]


def _cards(db: Session, *, q: str, board_id: int | None, limit: int) -> list[dict[str, Any]]:
    """Statement 2 plus the labels query: the ranked `SearchCard[]` of Section 4.7."""
    match = _match_expression(q)
    if not match:
        return []
    sql = _CARDS_SQL.format(board_filter="" if board_id is None else _BOARD_FILTER_SQL)
    parameters: dict[str, Any] = {"q": match, "limit": limit}
    if board_id is not None:
        parameters["board_id"] = board_id
    rows = db.execute(text(sql), parameters).mappings().all()
    labels = _labels_by_card(db, card_ids=[row["id"] for row in rows])
    return [
        {
            "id": row["id"],
            "short_id": row["short_id"],
            "title": row["title"],
            "board_id": row["board_id"],
            "list_id": row["list_id"],
            "board_name": row["board_name"],
            "list_name": row["list_name"],
            "labels": labels[row["id"]],
        }
        for row in rows
    ]


def _labels_by_card(db: Session, *, card_ids: list[int]) -> dict[int, list[dict[str, Any]]]:
    """Statement 3: the `{color, tone, name}` chips of every hit, in `labels.position` order.

    One query for the whole page of hits, keyed by card id. A card with no labels is absent from
    the result and reads back as an empty list, which is what `SearchCard.labels` expects.
    """
    chips: dict[int, list[dict[str, Any]]] = defaultdict(list)
    if not card_ids:
        return chips
    rows = db.execute(
        select(CardLabel.card_id, Label.color, Label.tone, Label.name)
        .join(Label, Label.id == CardLabel.label_id)
        .where(CardLabel.card_id.in_(card_ids))
        .order_by(Label.position, Label.id)
    )
    for row in rows:
        chips[row.card_id].append({"color": row.color, "tone": row.tone, "name": row.name})
    return chips


def _match_expression(q: str) -> str:
    """Turn the user's text into a safe FTS5 `MATCH` expression, or `""` when it has no terms.

    Each alphanumeric run becomes a quoted prefix term - `launch v2` becomes `"launch"* "v2"*` -
    which FTS5 AND's together, so more words narrow the hit list the way a person expects. Quoting
    is what disarms the operators: inside a string, `*`, `-`, `^`, `:`, `NEAR` and a keyword such
    as `OR` are literal text, and the pattern has already dropped every character that could close
    the quote or open a bracket. `MAX_TERMS` bounds the work per request.
    """
    terms = _TERM_PATTERN.findall(q)[:MAX_TERMS]
    return " ".join(f'"{term}"*' for term in terms)
