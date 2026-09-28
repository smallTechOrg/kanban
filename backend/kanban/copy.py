"""Deep copies: one card with the children its `keep` flags ask for, and a whole list.

Sections 4.4, 4.5 and 6.7. This module owns the *row duplication* and nothing else: it opens no
transaction, records no activity and computes no position (CLAUDE.md section 3). Its callers -
`services/cards.py` for `POST /api/cards/{card_id}/copy` and `services/lists.py` for
`POST /api/lists/{list_id}/copy` - are inside one `write_tx()`, hand it the `position` and the
starting `short_id` they read under the write lock, and record the activity rows for what comes
back. It is therefore the one place the answer to "what *is* a copy of a card?" is written down,
which is why the list copy that `services/lists.py` used to carry moved here: a list copy is the
card copy applied to every card of the column, and the two had already started to drift.

The dependency runs one way, `services -> copy`, so nothing here imports a service: the two
values a copy cannot work out for itself (the destination `position` and the per-board `short_id`
sequence of `services.cards.next_short_id`) arrive as arguments.

Two rules of the copy live here because they are facts about a copy rather than about a request:

* a copy that lands on another board keeps neither labels nor members (Section 4.5), because both
  are per-board rows that would dangle - `card_labels` points at labels of the source board and a
  `card_members` row at a user who need not be a member of the target;
* an `attachment` cover points at an `attachments.id`, so it is remapped onto the copied
  attachment and dropped when the attachments were not copied at all. Without that a copy would
  either show the *source's* image or carry a cover pointing at a row on another card.
"""

import shutil
from collections.abc import Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import NamedTuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from kanban.config import settings
from kanban.models import (
    Attachment,
    Card,
    CardLabel,
    CardMember,
    Checklist,
    ChecklistItem,
    Comment,
    List,
)


@dataclass(frozen=True)
class Keep:
    """The `keep` object of `POST /api/cards/{card_id}/copy` (Section 4.5).

    Every flag defaults to `false`, exactly as the endpoint documents; the popover sends all five
    explicitly with `true` defaults of its own (Section 2.6.5).
    """

    labels: bool = False
    members: bool = False
    checklists: bool = False
    attachments: bool = False
    comments: bool = False


#: What a list copy keeps: everything. Copying a column is Trello's "duplicate this list", so each
#: card arrives whole rather than as the title-only default of the card popover.
EVERYTHING = Keep(labels=True, members=True, checklists=True, attachments=True, comments=True)


class CardCopy(NamedTuple):
    """One copied card: the source row, the new row, and the comment rows that were duplicated.

    The comments come back because the card feed is driven by `activities` alone (Section 3.8): a
    copied `comments` row with no `comment.added` activity row would be counted by the tile badge
    and yet be invisible in the modal, so the caller records one row per comment.
    """

    source: Card
    card: Card
    comments: list[Comment]


class ListCopy(NamedTuple):
    """One copied list and the copy of each of its cards, in the order they were copied."""

    list: List
    cards: list[CardCopy]


def copy_card(
    db: Session,
    source: Card,
    *,
    list_id: int,
    board_id: int,
    short_id: int,
    title: str,
    position: float,
    keep: Keep,
    created_by: int,
    is_template: bool | None = None,
) -> CardCopy:
    """Duplicate one card into `list_id` of `board_id` (Sections 4.5 and 4.4).

    The card's own columns - description, dates, reminder, cover and template flag - always come
    along; the children come only when `keep` asks for them. `short_id` and `position` are the
    values the caller read inside its `write_tx`, so no sequence and no position is invented here.
    `is_template` overrides the source's flag when given, which is what "Create from template"
    passes. Labels and members are dropped when `board_id` is not the source's board. Raises
    nothing: every check a copy needs (the destination list, the target board, the title) belongs
    to the caller.
    """
    if board_id != source.board_id:
        keep = replace(keep, labels=False, members=False)
    card = Card(
        board_id=board_id,
        list_id=list_id,
        short_id=short_id,
        title=title,
        description=source.description,
        position=position,
        start_at=source.start_at,
        due_at=source.due_at,
        due_complete=source.due_complete,
        due_reminder_minutes=source.due_reminder_minutes,
        cover_type=source.cover_type,
        cover_value=source.cover_value,
        cover_size=source.cover_size,
        is_template=source.is_template if is_template is None else int(is_template),
        created_by=created_by,
    )
    db.add(card)
    db.flush()  # the id every child row below references
    if keep.labels:
        _copy_labels(db, source_card_id=source.id, target_card_id=card.id)
    if keep.members:
        _copy_members(db, source_card_id=source.id, target_card_id=card.id)
    if keep.checklists:
        _copy_checklists(db, source=source, target=card)
    attachments = (
        _copy_attachments(db, source_card_id=source.id, target_card_id=card.id)
        if keep.attachments
        else {}
    )
    _retarget_cover(card, attachments)
    comments = (
        _copy_comments(db, source_card_id=source.id, target_card_id=card.id)
        if keep.comments
        else []
    )
    return CardCopy(source=source, card=card, comments=comments)


def copy_list(
    db: Session,
    source: List,
    *,
    board_id: int,
    name: str,
    position: float,
    cards: Sequence[Card],
    short_id: int,
    created_by: int,
) -> ListCopy:
    """Duplicate a list and the `cards` the caller selected for it (Section 4.4).

    The column's colour comes along and each card keeps its own `position`, so the copy reads
    top-to-bottom exactly like the original; `short_id` is the first of the consecutive per-board
    ids the copied cards take (the caller read it inside its `write_tx`). Which cards are copied is
    the caller's rule - `services/lists.py` passes the active ones - and every card arrives whole
    (`EVERYTHING`).
    """
    copy = List(board_id=board_id, name=name, position=position, color=source.color)
    db.add(copy)
    db.flush()  # the id every copied card references
    return ListCopy(
        list=copy,
        cards=[
            copy_card(
                db,
                card,
                list_id=copy.id,
                board_id=board_id,
                short_id=short_id + offset,
                title=card.title,
                position=card.position,
                keep=EVERYTHING,
                created_by=created_by,
            )
            for offset, card in enumerate(cards)
        ],
    )


# --------------------------------------------------------------------------- the children


def _copy_labels(db: Session, *, source_card_id: int, target_card_id: int) -> None:
    """Duplicate the `card_labels` rows; only ever called within one board."""
    for label_id in db.execute(
        select(CardLabel.label_id).where(CardLabel.card_id == source_card_id)
    ).scalars():
        db.add(CardLabel(card_id=target_card_id, label_id=label_id))


def _copy_members(db: Session, *, source_card_id: int, target_card_id: int) -> None:
    """Duplicate the `card_members` rows; only ever called within one board.

    Watchers are deliberately not copied: watching is a per-user subscription (Section 4.1), not a
    property of the card, and `keep` has no flag for it.
    """
    for user_id in db.execute(
        select(CardMember.user_id).where(CardMember.card_id == source_card_id)
    ).scalars():
        db.add(CardMember(card_id=target_card_id, user_id=user_id))


def _copy_checklists(db: Session, *, source: Card, target: Card) -> None:
    """Duplicate every checklist of the card with its items, positions and checked state.

    The copy gets rows of its own - nothing is shared - so ticking an item on the copy leaves the
    original alone. An item's `assignee_id` is dropped when the copy lands on another board,
    because the assignee must be a member of the card's board (Section 4.6) and this is the same
    rule that drops the card's own members.
    """
    keeps_assignees = target.board_id == source.board_id
    for checklist in db.execute(
        select(Checklist)
        .where(Checklist.card_id == source.id)
        .order_by(Checklist.position, Checklist.id)
    ).scalars():
        copy = Checklist(card_id=target.id, name=checklist.name, position=checklist.position)
        db.add(copy)
        db.flush()  # the id the items reference
        for item in db.execute(
            select(ChecklistItem)
            .where(ChecklistItem.checklist_id == checklist.id)
            .order_by(ChecklistItem.position, ChecklistItem.id)
        ).scalars():
            db.add(
                ChecklistItem(
                    checklist_id=copy.id,
                    name=item.name,
                    position=item.position,
                    is_checked=item.is_checked,
                    checked_at=item.checked_at,
                    due_at=item.due_at,
                    assignee_id=item.assignee_id if keeps_assignees else None,
                )
            )


def _copy_comments(db: Session, *, source_card_id: int, target_card_id: int) -> list[Comment]:
    """Duplicate the card's comments, oldest first, keeping each original author.

    The rows are new, so `created_at` is the time of the copy; the author is preserved because the
    sentence the feed renders is the comment's own ("Asha commented on this card"), while the
    `comment.added` activity row the caller writes carries the same author. Returns the new rows in
    the order they were created.
    """
    copies = [
        Comment(card_id=target_card_id, user_id=comment.user_id, body=comment.body)
        for comment in db.execute(
            select(Comment)
            .where(Comment.card_id == source_card_id)
            .order_by(Comment.created_at, Comment.id)
        ).scalars()
    ]
    for comment in copies:
        db.add(comment)
    db.flush()  # the ids the `comment.added` rows carry in `data.comment_id`
    return copies


def _copy_attachments(db: Session, *, source_card_id: int, target_card_id: int) -> dict[int, int]:
    """Duplicate the card's attachments, files included, and map source id -> copy id.

    A link attachment is one row. An upload owns the directory named by its id (Section 3.11), so
    the copy's row is inserted first - SQLite assigns the id inside the open transaction - and then
    its `file_path`, `url` and `thumb_path` are retargeted and the source directory is copied onto
    the new one. The copy happens inside the caller's transaction, so a rollback leaves at most an
    orphan directory that `kanban cleanup-orphans` reclaims, never a row without its file.
    """
    copied: dict[int, int] = {}
    for source in db.execute(
        select(Attachment)
        .where(Attachment.card_id == source_card_id)
        .order_by(Attachment.created_at, Attachment.id)
    ).scalars():
        attachment = Attachment(
            card_id=target_card_id,
            user_id=source.user_id,
            kind=source.kind,
            name=source.name,
            url=source.url,
            file_path=source.file_path,
            mime_type=source.mime_type,
            size_bytes=source.size_bytes,
            sha256=source.sha256,
            is_image=source.is_image,
            width=source.width,
            height=source.height,
            dominant_color=source.dominant_color,
            thumb_path=source.thumb_path,
        )
        db.add(attachment)
        db.flush()  # the id that names the copy's own directory
        _copy_files(attachment, source_id=source.id)
        copied[source.id] = attachment.id
    return copied


def _copy_files(attachment: Attachment, *, source_id: int) -> None:
    """Retarget an uploaded attachment's paths onto its own id and copy the files across.

    The layout itself is never restated here: the id segment of the stored paths is rewritten and
    the source's own directory - `(uploads_dir / file_path).parent`, whatever that is - is copied
    to the new one, so this stays correct if the upload slice ever changes where it writes.
    """
    if attachment.file_path is None:  # a link attachment has no file of its own
        return
    source_dir = settings.uploads_dir / Path(attachment.file_path).parent
    old, new = f"/{source_id}/", f"/{attachment.id}/"
    attachment.file_path = attachment.file_path.replace(old, new, 1)
    attachment.url = attachment.url.replace(old, new, 1)
    if attachment.thumb_path is not None:
        attachment.thumb_path = attachment.thumb_path.replace(old, new, 1)
    target_dir = settings.uploads_dir / Path(attachment.file_path).parent
    if source_dir.is_dir() and target_dir != source_dir:
        shutil.copytree(source_dir, target_dir, dirs_exist_ok=True)


def _retarget_cover(card: Card, attachments: dict[int, int]) -> None:
    """Point an `attachment` cover at the copied attachment, or clear it (Section 4.5).

    A `color` cover is a palette key and needs nothing. An `attachment` cover holds an
    `attachments.id`, which is only meaningful on the card that owns the row: with the attachments
    copied it becomes the copy's own id, and without them the card has no cover at all.
    """
    if card.cover_type != "attachment":
        return
    source_id = int(card.cover_value) if (card.cover_value or "").isdigit() else None
    target_id = attachments.get(source_id) if source_id is not None else None
    if target_id is None:
        card.cover_type = None
        card.cover_value = None
    else:
        card.cover_value = str(target_id)
