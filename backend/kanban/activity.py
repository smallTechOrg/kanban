"""The activity log (Section 3.8).

`record()` is the only way an `activities` row is written (CLAUDE.md section 3): it stamps the
row with the transaction's `board_version`, which is what SSE replays against, and validates the
type against the closed list in `constants.py`. Never `db.add(Activity(...))` by hand.
"""

import json
from typing import Any

from kanban.constants import ACTIVITY_TYPES
from kanban.db import WriteCtx
from kanban.models import Activity


def record(
    ctx: WriteCtx,
    type: str,
    card_id: int | None = None,
    list_id: int | None = None,
    board_id: int | None = None,
    **data: Any,
) -> Activity:
    """Append one immutable activity row inside the open write transaction.

    `data` holds the denormalised names captured at write time (`card_title`, `list_name`,
    `label_name`, ...) so a rendered sentence survives later renames and deletions.
    `board_id` defaults to the transaction's single board; a cross-board move passes it
    explicitly, once per board. Raises `ValueError` for a type outside `ACTIVITY_TYPES`.
    """
    if type not in ACTIVITY_TYPES:
        raise ValueError(f"Unknown activity type: {type!r}")
    target_board_id = ctx.board_id if board_id is None else board_id
    row = Activity(
        board_id=target_board_id,
        card_id=card_id,
        list_id=list_id,
        type=type,
        data=json.dumps(data, separators=(",", ":"), sort_keys=True),
        board_version=ctx.versions[target_board_id],
    )
    ctx.db.add(row)
    return row
