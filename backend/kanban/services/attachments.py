"""Attachments and card covers (Sections 4.5, 4.6, 6.9 and 3.8).

Every mutation here opens exactly one `write_tx()` and records its rows through
`activity.record()` (CLAUDE.md section 3). The file work is `kanban/storage.py`'s: this module
decides *when* bytes move, never how, and it never holds the write lock while they do - the upload
has already been received, hashed and thumbnailed into `uploads/tmp/` before
`create_file_attachment` is called, and a delete removes its directory only after the transaction
has committed, because a rollback can un-delete a row but never a file.

Covers live here rather than in `services/cards.py` for the same reason the two halves of the
cover popover do: `cards.cover_value` is an `attachments.id` whenever `cover_type` is
`'attachment'`, so validating a cover means reading this aggregate's rows, and deleting an
attachment means clearing a cover in the same transaction (Section 4.6). Every *shape* is
`services/cards.py`'s, though: both cover endpoints answer with its `card_summary()`, and the
`AttachmentOut` of Section 4.6 is its `attachment_out()`, because `CardDetail` carries
`attachments` and this module already imports that one - the reverse edge would be a cycle
(CLAUDE.md section 8).
"""

from typing import Any, NamedTuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from kanban import activity, storage
from kanban.constants import COVER_COLORS
from kanban.db import write_tx
from kanban.errors import BadRequest, NotFound
from kanban.models import Attachment, Card, User
from kanban.services import cards
from kanban.services.cards import ATTACHMENT_COVER, add_link_attachment, attachment_out


class AttachmentMutation(NamedTuple):
    """What an attachment mutation returns: the row plus the version it produced (Section 4.1)."""

    item: dict[str, Any]
    board_version: int


def _load_card(db: Session, card_id: int) -> Card:
    """Re-read the card under the write lock; never from the identity map (Section 6.7.2)."""
    card = db.get(Card, card_id, populate_existing=True)
    if card is None:  # pragma: no cover - the router's dependency resolved it a moment ago
        raise NotFound("not_found", "That card does not exist.")
    return card


def _load_attachment(db: Session, attachment_id: int) -> Attachment:
    """Re-read one attachment row; `expire_on_commit` is off, so never from the identity map."""
    row = db.get(Attachment, attachment_id, populate_existing=True)
    if row is None:  # pragma: no cover - the router's dependency resolved it a moment ago
        raise NotFound("not_found", "That attachment does not exist.")
    return row


def create_file_attachment(
    db: Session,
    user: User,
    *,
    board_id: int,
    card_id: int,
    upload: storage.PreparedUpload,
) -> AttachmentMutation:
    """Attach an already-received file to a card (Sections 4.6 and 6.9 steps 4-7).

    The row is inserted before its files are placed because the directory is named after the id
    SQLite assigns inside the transaction; `url`, `file_path` and `thumb_path` are therefore
    written as a second statement of the same transaction, and no client ever sees the interim
    state. Any failure rolls the row back and deletes both the temp files and anything already
    renamed into place, so a crash leaves at most an orphan directory and never a dangling row.
    Raises `NotFound` when the card is gone and `Busy` (503) on a lock timeout.
    """
    attachment_id: int | None = None
    try:
        with write_tx(db, [board_id]) as ctx:
            card = _load_card(db, card_id)
            row = Attachment(
                card_id=card_id,
                user_id=user.id,
                kind="upload",
                name=upload.display_name,
                url="",  # the id below is what names the file, so the URL cannot exist yet
                mime_type=upload.mime_type,
                size_bytes=upload.size_bytes,
                sha256=upload.sha256,
                is_image=int(upload.is_image),
                width=upload.image.width if upload.image else None,
                height=upload.image.height if upload.image else None,
                dominant_color=upload.image.dominant_color if upload.image else None,
            )
            db.add(row)
            db.flush()
            attachment_id = int(row.id)
            stored = storage.place_upload(attachment_id, upload)
            row.file_path = stored.file_path
            row.thumb_path = stored.thumb_path
            row.url = f"/uploads/{stored.file_path}"
            activity.record(
                ctx,
                "attachment.added",
                user_id=user.id,
                card_id=card_id,
                list_id=card.list_id,
                card_title=card.title,
                attachment_id=attachment_id,
                attachment_name=row.name,
                kind="upload",
            )
    except BaseException:
        if attachment_id is not None:
            storage.delete_upload(attachment_id)
        raise
    finally:
        storage.discard_upload(upload)  # a no-op once `place_upload` has renamed them
    return AttachmentMutation(
        item=attachment_out(db, _load_attachment(db, attachment_id)),
        board_version=ctx.board_version,
    )


def create_link_attachment(
    db: Session, user: User, *, board_id: int, card_id: int, url: str, name: str | None = None
) -> AttachmentMutation:
    """Attach a link to a card: no file, no thumbnail, no disk (Section 4.6).

    `name` defaults to the URL's host, which is what the "Search or paste a link" form leaves
    empty. The row and its `attachment.added` are `services/cards.add_link_attachment()`'s, the
    same pair a pasted-URL card title writes (Section 4.4); this function is only the transaction
    around them. Raises `NotFound` when the card is gone and `Busy` (503) on a lock timeout.
    """
    with write_tx(db, [board_id]) as ctx:
        card = _load_card(db, card_id)
        attachment_id = add_link_attachment(db, ctx, user, card=card, url=url, name=name)
    return AttachmentMutation(
        item=attachment_out(db, _load_attachment(db, attachment_id)),
        board_version=ctx.board_version,
    )


def rename_attachment(
    db: Session, user: User, *, board_id: int, attachment_id: int, name: str
) -> AttachmentMutation:
    """Rename an attachment's display name; the file on disk is untouched (Section 4.6).

    A name equal to the stored one is not a rename: nothing is recorded, exactly as re-saving an
    unchanged comment records nothing. The `attachment.renamed` row keeps the old name in `from`
    so the feed can render "renamed the attachment Mock-up (from photo.png)" (Section 3.8).
    Raises `NotFound` when the attachment is gone and `Busy` (503) on a lock timeout.
    """
    with write_tx(db, [board_id]) as ctx:
        row = _load_attachment(db, attachment_id)
        if name != row.name:
            card = _load_card(db, row.card_id)
            previous = row.name
            row.name = name
            activity.record(
                ctx,
                "attachment.renamed",
                user_id=user.id,
                card_id=card.id,
                list_id=card.list_id,
                card_title=card.title,
                attachment_id=attachment_id,
                attachment_name=name,
                kind=row.kind,
                **{"from": previous},
            )
    return AttachmentMutation(
        item=attachment_out(db, _load_attachment(db, attachment_id)),
        board_version=ctx.board_version,
    )


def delete_attachment(db: Session, user: User, *, board_id: int, attachment_id: int) -> None:
    """Delete an attachment, clearing the card's cover with it (Sections 4.6 and 6.9).

    Two entities can change, so two rows are recorded: `attachment.deleted` always, and
    `card.cover_removed` when this attachment *was* the cover - the cover is cleared inside the
    same transaction, never by a second request, so a card can never point at a row that is gone.
    The directory is removed after the commit, because a rollback cannot bring bytes back.
    Raises `NotFound` when the attachment is gone and `Busy` (503) on a lock timeout.
    """
    with write_tx(db, [board_id]) as ctx:
        row = _load_attachment(db, attachment_id)
        card = _load_card(db, row.card_id)
        kind = row.kind
        activity.record(
            ctx,
            "attachment.deleted",
            user_id=user.id,
            card_id=card.id,
            list_id=card.list_id,
            card_title=card.title,
            attachment_id=attachment_id,
            attachment_name=row.name,
            kind=kind,
        )
        if card.cover_type == ATTACHMENT_COVER and card.cover_value == str(attachment_id):
            card.cover_type = None
            card.cover_value = None
            activity.record(
                ctx,
                "card.cover_removed",
                user_id=user.id,
                card_id=card.id,
                list_id=card.list_id,
                card_title=card.title,
            )
        db.delete(row)
    if kind == "upload":
        storage.delete_upload(attachment_id)


def _validated_cover_value(db: Session, *, card_id: int, kind: str, value: str) -> str:
    """The `cards.cover_value` a cover request may store, or `BadRequest` (Section 4.5).

    A `color` cover must name a `constants.COVER_COLORS` key - the palette has one source
    (CLAUDE.md section 3) - and an `attachment` cover must name an attachment **of this card**
    that has a thumbnail, so a cover can neither point across cards nor at a PDF. Raises
    `BadRequest` (400) in every other case.
    """
    if kind != ATTACHMENT_COVER:
        if value not in COVER_COLORS:
            raise BadRequest("bad_request", f"{value!r} is not a cover colour.")
        return value
    if not value.isdigit():
        raise BadRequest("bad_request", "An attachment cover needs an attachment id.")
    thumb_path = db.execute(
        select(Attachment.thumb_path).where(
            Attachment.id == int(value), Attachment.card_id == card_id
        )
    ).scalar_one_or_none()
    if thumb_path is None:
        raise BadRequest("bad_request", "That attachment cannot be this card's cover.")
    return value


def set_cover(
    db: Session, user: User, *, board_id: int, card_id: int, kind: str, value: str, size: str
) -> cards.CardMutation:
    """Put a colour or attachment cover on a card (Section 4.5).

    Answers with `services.cards.card_summary()` rather than a shape of its own, so the tile the
    client patches in is the same object every other card mutation returns. Raises `BadRequest`
    (400) for a colour outside the palette or an attachment that is not a thumbnailed row of this
    card, `NotFound` when the card is gone and `Busy` (503) on a lock timeout.
    """
    with write_tx(db, [board_id]) as ctx:
        card = _load_card(db, card_id)
        stored_value = _validated_cover_value(db, card_id=card_id, kind=kind, value=value)
        card.cover_type = kind
        card.cover_value = stored_value
        card.cover_size = size
        activity.record(
            ctx,
            "card.cover_changed",
            user_id=user.id,
            card_id=card_id,
            list_id=card.list_id,
            card_title=card.title,
            cover_type=kind,
            cover_value=stored_value,
            cover_size=size,
        )
    return cards.CardMutation(
        item=cards.card_summary(db, user, card_id=card_id), board_version=ctx.board_version
    )


def clear_cover(db: Session, user: User, *, board_id: int, card_id: int) -> cards.CardMutation:
    """Remove a card's cover (Section 4.5), leaving `cover_size` for the next one.

    A card that has no cover records nothing - removing nothing is not an action, the same rule
    `rename_attachment` applies to an unchanged name - but the response still carries the
    transaction's `board_version`, so the client's version gate stays in step either way.
    Raises `NotFound` when the card is gone and `Busy` (503) on a lock timeout.
    """
    with write_tx(db, [board_id]) as ctx:
        card = _load_card(db, card_id)
        if card.cover_type is not None:
            card.cover_type = None
            card.cover_value = None
            activity.record(
                ctx,
                "card.cover_removed",
                user_id=user.id,
                card_id=card_id,
                list_id=card.list_id,
                card_title=card.title,
            )
    return cards.CardMutation(
        item=cards.card_summary(db, user, card_id=card_id), board_version=ctx.board_version
    )
