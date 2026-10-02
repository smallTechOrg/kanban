"""Board labels and the card-to-label join (Sections 4.3 and 4.5).

Every mutation here opens exactly one `write_tx()`, takes its position from `ordering.py` and
records its activity rows through `activity.record()`. Permission checks are not repeated: by the
time a router calls in, `access.board_access()` has resolved the board and applied the
closed-board guard, so no function here repeats either check
in this module (CLAUDE.md section 3). Each mutation re-reads its rows under the write lock, because
the router's read snapshot is gone by then and may be stale (Section 6.7.2 step 6).

`list_board_labels` hands back the rows `services.boards.list_labels` already assembles for the
board document rather than restating that query and shape; the mutations hand back the `labels` row
itself, which the router turns into the `LabelOut` those rows validate against. The array both card
toggles answer with is `services.cards.card_label_ids`, the same one `CardSummary.label_ids` is
built from, so the label `position` ordering of Section 4.5 is written down once.
"""

from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from kanban import activity
from kanban.db import write_tx
from kanban.errors import BadRequest, NotFound
from kanban.models import Card, CardLabel, Label
from kanban.ordering import place_in_container
from kanban.services import boards
from kanban.services.cards import card_label_ids


def _load(db: Session, label_id: int) -> Label:
    """Re-read a label, never from the identity map.

    `expire_on_commit` is off on the session (Section 6.5.2), so an instance left over from a
    transaction still carries pre-commit values; `populate_existing` forces the SELECT. Inside a
    `write_tx` this is also the re-read under the write lock of Section 6.7.2 step 6.
    """
    row = db.get(Label, label_id, populate_existing=True)
    if row is None:  # pragma: no cover - the router's dependency resolved it a moment ago
        raise NotFound("not_found", "That label does not exist.")
    return row


def _locked_label(db: Session, *, label_id: int, board_id: int) -> Label:
    """The label, re-read inside the open write transaction. Raises `NotFound` if it moved away."""
    row = _load(db, label_id)
    if row.board_id != board_id:  # pragma: no cover - lost a race with a deleter
        raise NotFound("not_found", "That label does not exist.")
    return row


def _locked_card(db: Session, *, card_id: int, board_id: int) -> Card:
    """The card, re-read inside the open write transaction (Section 6.7.2 step 6)."""
    row = db.get(Card, card_id, populate_existing=True)
    if row is None or row.board_id != board_id:  # pragma: no cover - lost a race with a deleter
        raise NotFound("not_found", "That card does not exist.")
    return row


def _attached_row_id(db: Session, *, card_id: int, label_id: int) -> int | None:
    """The `card_labels` row joining these two, or None - what makes both toggles idempotent."""
    return db.execute(
        select(CardLabel.id).where(CardLabel.card_id == card_id, CardLabel.label_id == label_id)
    ).scalar_one_or_none()


def list_board_labels(db: Session, *, board_id: int) -> list[dict[str, Any]]:
    """The board's labels ordered by `position` (Section 4.3).

    The board document carries the same array, so the query and the row shape live in
    `services.boards.list_labels` and this delegates to them rather than writing either a second
    time (CLAUDE.md section 3). It is a read, so a closed board still answers it.
    """
    return boards.list_labels(db, board_id=board_id)


def create_label(
    db: Session, *, board_id: int, name: str, color: str, tone: str
) -> tuple[Label, int]:
    """Append a label to the board's palette (Sections 4.3 and 3.6).

    The position is `max(position) + 65536`, computed by `ordering.place_in_container` with no
    index. Activity `label.created`. Raises `Busy` (503) when the write lock is unavailable.
    """
    with write_tx(db, [board_id]) as ctx:
        position, _ = place_in_container(db, Label, "board_id", board_id)
        row = Label(board_id=board_id, name=name, color=color, tone=tone, position=position)
        db.add(row)
        db.flush()  # the id the activity row references
        activity.record(
            ctx,
            "label.created",
            label_id=row.id,
            label_name=name,
            label_color=color,
            label_tone=tone,
        )
        label_id = row.id
    return _load(db, label_id), ctx.board_version


def update_label(
    db: Session, *, label_id: int, board_id: int, changes: dict[str, Any]
) -> tuple[Label, int]:
    """Rename, recolour or re-tone a label (Section 4.3).

    `changes` is the `exclude_unset` dump of `LabelUpdateIn`. One `label.updated` row carries the
    new values plus all three previous ones (Section 3.8), and nothing is recorded when every
    field is already what it is being set to. Raises `Busy` (503).
    """
    with write_tx(db, [board_id]) as ctx:
        row = _locked_label(db, label_id=label_id, board_id=board_id)
        before = {"name": row.name, "color": row.color, "tone": row.tone}
        changed = {field: value for field, value in changes.items() if value != getattr(row, field)}
        for field, value in changed.items():
            setattr(row, field, value)
        if changed:
            activity.record(
                ctx,
                "label.updated",
                label_id=label_id,
                label_name=row.name,
                label_color=row.color,
                label_tone=row.tone,
                from_name=before["name"],
                from_color=before["color"],
                from_tone=before["tone"],
            )
    return _load(db, label_id), ctx.board_version


def delete_label(db: Session, *, label_id: int, board_id: int) -> int:
    """Delete a label and every `card_labels` row of it, returning the new board version.

    Admin only (Section 4.3, a deliberate deviation from Trello recorded in Appendix B); the route
    declares `board_access()` and this function does not re-check it. The join rows go
    with the label through `ON DELETE CASCADE`, and their count is captured for the
    `label.deleted` activity row before the delete. Raises `Busy` (503).
    """
    with write_tx(db, [board_id]) as ctx:
        row = _locked_label(db, label_id=label_id, board_id=board_id)
        card_count = int(
            db.execute(
                select(func.count()).select_from(CardLabel).where(CardLabel.label_id == label_id)
            ).scalar_one()
        )
        activity.record(
            ctx,
            "label.deleted",
            label_id=label_id,
            label_name=row.name,
            label_color=row.color,
            label_tone=row.tone,
            card_count=card_count,
        )
        db.execute(delete(Label).where(Label.id == label_id))
    return ctx.board_version


def attach_label(
    db: Session, *, card_id: int, board_id: int, label_id: int
) -> tuple[list[int], int]:
    """Put a label on a card, idempotently (Section 4.5).

    Activity `card.label_added` only when the card did not carry the label already, so clicking a
    chip twice leaves one row behind. Raises `BadRequest` (400) when the label belongs to another
    board and `Busy` (503).
    """
    with write_tx(db, [board_id]) as ctx:
        card = _locked_card(db, card_id=card_id, board_id=board_id)
        label = db.get(Label, label_id, populate_existing=True)
        if label is None or label.board_id != board_id:
            raise BadRequest(
                "bad_request", "That label is not on this board.", {"label_ids": [label_id]}
            )
        if _attached_row_id(db, card_id=card_id, label_id=label_id) is None:
            db.add(CardLabel(card_id=card_id, label_id=label_id))
            activity.record(
                ctx,
                "card.label_added",
                card_id=card_id,
                card_title=card.title,
                label_id=label_id,
                label_name=label.name,
                label_color=label.color,
            )
    return card_label_ids(db, card_id=card_id), ctx.board_version


def detach_label(
    db: Session, *, card_id: int, board_id: int, label_id: int
) -> tuple[list[int], int]:
    """Take a label off a card, idempotently (Section 4.5).

    Detaching a label the card does not carry - including one that belongs to another board - is a
    no-op that records nothing and answers with the card's unchanged labels. Activity
    `card.label_removed` otherwise. Raises `Busy` (503).
    """
    with write_tx(db, [board_id]) as ctx:
        card = _locked_card(db, card_id=card_id, board_id=board_id)
        row_id = _attached_row_id(db, card_id=card_id, label_id=label_id)
        if row_id is not None:
            label = _locked_label(db, label_id=label_id, board_id=board_id)
            activity.record(
                ctx,
                "card.label_removed",
                card_id=card_id,
                card_title=card.title,
                label_id=label_id,
                label_name=label.name,
                label_color=label.color,
            )
            db.execute(delete(CardLabel).where(CardLabel.id == row_id))
    return card_label_ids(db, card_id=card_id), ctx.board_version
