"""my day palette: move every board off the Atlassian background colours

Revision ID: 0003_my_day_palette
Revises: 0002_personal_manager
Create Date: 2026-10-06

`constants.BOARD_COLORS` is now My Day's own nine muted fields rather than the nine primaries
Section 2.9.3 of docs/PLANNING.md inherited from Trello, and `BOARD_GRADIENTS` keeps its four
keys with both stops moved onto that palette.

A gradient needs no data change: the *key* is what `boards.background_value` stores, so a board
wearing `gradient-dusk` simply paints the new dusk. A solid colour stores the hex itself, so a
board created before this change would have kept a colour that is no longer on any swatch - a
background the picker cannot show as selected and nothing in the app can produce again. Each of
the nine old hexes is therefore rewritten to its nearest new one, which is a repaint and not a
loss: `background_type` is untouched, and a board whose background is an upload or a hex the
reader typed is left exactly as it is.

The downgrade puts the old hexes back. It is lossy in the one case where two old colours map
onto one new one - they do not here, the mapping is a bijection over the nine - so the pair is
written as two dicts and asserted to invert each other.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_my_day_palette"
down_revision: str | None = "0002_personal_manager"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Old `BOARD_COLORS` hex -> new one, by what each field looked like. Both sides are written out
#: rather than imported, because a migration must keep working when the constant moves again.
PALETTE: dict[str, str] = {
    "#0079BF": "#35598C",  # blue     -> denim
    "#D29034": "#B05440",  # orange   -> clay
    "#519839": "#3E6B4B",  # green    -> moss
    "#B04632": "#7A4A3B",  # red      -> cocoa
    "#89609E": "#6B3F82",  # purple   -> plum
    "#CD5A91": "#4C3FB5",  # pink     -> iris
    "#4BBF6B": "#67703A",  # lime     -> olive
    "#00AECC": "#1F6B73",  # sky      -> teal
    "#838C91": "#4B5168",  # grey     -> slate
}


def _repaint(mapping: dict[str, str]) -> None:
    """Rewrite `boards.background_value` for every solid background named in `mapping`."""
    boards = sa.table(
        "boards",
        sa.column("background_type", sa.Text),
        sa.column("background_value", sa.Text),
    )
    for old, new in mapping.items():
        op.execute(
            boards.update()
            .where(boards.c.background_type == op.inline_literal("color"))
            .where(boards.c.background_value == op.inline_literal(old))
            .values(background_value=op.inline_literal(new))
        )


def upgrade() -> None:
    _repaint(PALETTE)


def downgrade() -> None:
    inverse = {new: old for old, new in PALETTE.items()}
    if len(inverse) != len(PALETTE):  # pragma: no cover - the mapping above is a bijection
        raise RuntimeError("the palette mapping is not reversible")
    _repaint(inverse)
