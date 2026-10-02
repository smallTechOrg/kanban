"""The deep copy of a list: the column, its cards, and each card's labels and items.

Sections 4.4 and 6.7. This module owns the *row duplication* and nothing else: it opens no
transaction, records no activity and computes no position (CLAUDE.md section 3). Its one caller -
`services/lists.py` for `POST /api/lists/{list_id}/copy` - is inside one `write_tx()`, hands it
the `position` and the starting `short_id` it read under the write lock, and records the activity
rows for what comes back.

A card has no copy endpoint of its own, so `copy_card` below is private to the list copy: it is
the per-card half of "duplicate this column", not a second public answer to "what is a copy?".

The dependency runs one way, `services -> copy`, so nothing here imports a service: the two values
a copy cannot work out for itself (the destination `position` and the per-board `short_id`
sequence of `services.cards.next_short_id`) arrive as arguments.

One rule of the copy lives here because it is a fact about a copy rather than about a request: a
copy that lands on another board keeps no labels (Section 4.5), because `card_labels` points at
labels of the source board, which the target does not have.
"""

from collections.abc import Sequence
from typing import NamedTuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from kanban.models import Card, CardItem, CardLabel, List


class CardCopy(NamedTuple):
    """One copied card: the source row and the new row."""

    source: Card
    card: Card


class ListCopy(NamedTuple):
    """One copied list and the copy of each of its cards, in the order they were copied."""

    list: List
    cards: list[CardCopy]


def copy_list(
    db: Session,
    source: List,
    *,
    board_id: int,
    name: str,
    position: float,
    cards: Sequence[Card],
    short_id: int,
) -> ListCopy:
    """Duplicate a list and the `cards` the caller selected for it (Section 4.4).

    The column's colour comes along and each card keeps its own `position`, so the copy reads
    top-to-bottom exactly like the original; `short_id` is the first of the consecutive per-board
    ids the copied cards take (the caller read it inside its `write_tx`). Which cards are copied is
    the caller's rule - `services/lists.py` passes the active ones - and every card arrives whole,
    with its labels and its items.
    """
    copy = List(board_id=board_id, name=name, position=position, color=source.color)
    db.add(copy)
    db.flush()  # the id every copied card references
    return ListCopy(
        list=copy,
        cards=[
            _copy_card(
                db,
                card,
                list_id=copy.id,
                board_id=board_id,
                short_id=short_id + offset,
                position=card.position,
            )
            for offset, card in enumerate(cards)
        ],
    )


def _copy_card(
    db: Session,
    source: Card,
    *,
    list_id: int,
    board_id: int,
    short_id: int,
    position: float,
) -> CardCopy:
    """Duplicate one card into `list_id` of `board_id`, with its labels and items.

    The card's own columns - title, description, dates and reminder - always come along.
    `short_id` and `position` are the values the caller read inside its `write_tx`, so no sequence
    and no position is invented here. Labels are dropped when `board_id` is not the source's
    board. Raises nothing: every check a copy needs belongs to the caller.
    """
    card = Card(
        board_id=board_id,
        list_id=list_id,
        short_id=short_id,
        title=source.title,
        description=source.description,
        position=position,
        start_at=source.start_at,
        due_at=source.due_at,
        due_complete=source.due_complete,
        due_reminder_minutes=source.due_reminder_minutes,
    )
    db.add(card)
    db.flush()  # the id every child row below references
    if board_id == source.board_id:
        _copy_labels(db, source_card_id=source.id, target_card_id=card.id)
    _copy_items(db, source_card_id=source.id, target_card_id=card.id)
    return CardCopy(source=source, card=card)


def _copy_labels(db: Session, *, source_card_id: int, target_card_id: int) -> None:
    """Duplicate the `card_labels` rows; only ever called within one board."""
    for label_id in db.execute(
        select(CardLabel.label_id).where(CardLabel.card_id == source_card_id)
    ).scalars():
        db.add(CardLabel(card_id=target_card_id, label_id=label_id))


def _copy_items(db: Session, *, source_card_id: int, target_card_id: int) -> None:
    """Duplicate every item of the card, with its position, checked state and due date.

    Duplicating a column reproduces each card as it stands, ticks included: a half-done card
    copies as half done.
    """
    for item in db.execute(
        select(CardItem)
        .where(CardItem.card_id == source_card_id)
        .order_by(CardItem.position, CardItem.id)
    ).scalars():
        db.add(
            CardItem(
                card_id=target_card_id,
                name=item.name,
                position=item.position,
                is_checked=item.is_checked,
                checked_at=item.checked_at,
                due_at=item.due_at,
            )
        )
