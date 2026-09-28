"""Attachments and card covers: `/api/cards/{card_id}/attachments`, `/api/attachments/{id}`,
`/api/cards/{card_id}/cover` (Sections 4.5, 4.6 and 6.9).

Thin by contract (Section 6.4) with one exception the spec asks for: `POST
/api/cards/{card_id}/attachments` answers to two content types, "content-type decides the branch"
(Section 4.6), and FastAPI cannot declare a JSON body and an `UploadFile` on one signature - the
moment a `File()` parameter exists, every request is parsed as a form. The handler therefore reads
the raw `Request`, dispatches on the header and validates the JSON branch against
`AttachmentCreateIn` itself, raising FastAPI's own `RequestValidationError` so a bad link body
renders exactly like any other 422 (Section 6.10). `openapi_extra` advertises both bodies, with
the JSON schema generated from that same model rather than written out a second time.

The upload route is `async def` (Section 6.4) because it awaits the received spool. Everything
after that - Pillow, and the short `write_tx` - runs in `run_in_threadpool`, so the event loop is
never blocked and the write lock is never held while bytes or thumbnails are in flight.

The two access dependencies are `auth.py`'s, like every other child-row route: `card_access` for
the two `/api/cards/...` paths and `attachment_access` - the seventh factory - for the two keyed by
an attachment id, so no permission decision is written down here (CLAUDE.md section 3).
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path, Request, status
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from kanban import storage
from kanban.auth import BoardCtx, CurrentUser, Db, Role, attachment_access, card_access
from kanban.models import User
from kanban.schemas.attachments import (
    AttachmentCreateIn,
    AttachmentMutated,
    AttachmentOut,
    AttachmentUpdateIn,
    CoverIn,
)
from kanban.schemas.cards import CardMutated, CardSummary
from kanban.services import attachments as service

router = APIRouter(tags=["attachments"])

CardId = Annotated[int, Path(ge=1)]
AttachmentId = Annotated[int, Path(ge=1)]

#: The multipart branch of the create route, and the form field Section 6.9 names.
MULTIPART_PREFIX = "multipart/form-data"
FILE_FIELD = "file"


#: Attaching, renaming, deleting and covering all need `member`, and are refused while closed.
CardAccess = Annotated[BoardCtx, Depends(card_access(Role.member))]
AttachmentAccess = Annotated[BoardCtx, Depends(attachment_access(Role.member))]

#: Section 4.6's two request bodies on one path, as the OpenAPI document advertises them. The
#: JSON schema is generated from the model, so `gen:types` cannot drift from the validation.
CREATE_REQUEST_BODY: dict[str, Any] = {
    "required": True,
    "content": {
        "multipart/form-data": {
            "schema": {
                "type": "object",
                "properties": {FILE_FIELD: {"type": "string", "format": "binary"}},
                "required": [FILE_FIELD],
            }
        },
        "application/json": {"schema": AttachmentCreateIn.model_json_schema()},
    },
}


def _validation_error(field: str, message: str) -> RequestValidationError:
    """A 422 in FastAPI's own shape, `loc` included, for the hand-validated create body."""
    return RequestValidationError(
        [{"type": "missing", "loc": ("body", field), "msg": message, "input": None}]
    )


def _link_body(payload: Any) -> AttachmentCreateIn:
    """`AttachmentCreateIn` from a hand-read JSON body, or the 422 FastAPI would have raised.

    Re-raising Pydantic's own error list under a `body` prefix is what makes this branch
    indistinguishable from a declared body: `errors.py` renders the one envelope and the message
    shape of Section 4.1 (`url: String should match pattern ...`) without a second formatter.
    """
    try:
        return AttachmentCreateIn.model_validate(payload)
    except ValidationError as exc:
        raise RequestValidationError(
            [{**error, "loc": ("body", *error["loc"])} for error in exc.errors()]
        ) from exc


async def _create_from_upload(
    request: Request, db: Session, user: User, *, board_id: int, card_id: int
) -> service.AttachmentMutation:
    """The multipart branch: receive, hash, thumbnail, then one short transaction (Section 6.9)."""
    form = await request.form()
    try:
        field = form.get(FILE_FIELD)
        if not isinstance(field, UploadFile):
            raise _validation_error(FILE_FIELD, "Field required")
        filename = field.filename
        received = await storage.save_upload(field, max_bytes=storage.max_upload_bytes())
    finally:
        await form.close()
    upload = await run_in_threadpool(storage.prepare_upload, received, filename=filename)
    return await run_in_threadpool(
        service.create_file_attachment,
        db,
        user,
        board_id=board_id,
        card_id=card_id,
        upload=upload,
    )


async def _create_from_link(
    request: Request, db: Session, user: User, *, board_id: int, card_id: int
) -> service.AttachmentMutation:
    """The JSON branch: `{url, name?}`, validated here so 422 reads like every other 422."""
    try:
        payload = await request.json()
    except ValueError as exc:
        raise _validation_error("url", "A link body must be JSON.") from exc
    body = _link_body(payload)
    return await run_in_threadpool(
        service.create_link_attachment,
        db,
        user,
        board_id=board_id,
        card_id=card_id,
        url=body.url,
        name=body.name,
    )


@router.post(
    "/cards/{card_id}/attachments",
    response_model=AttachmentMutated,
    status_code=status.HTTP_201_CREATED,
    openapi_extra={"requestBody": CREATE_REQUEST_BODY},
)
async def create_attachment(
    card_id: CardId, request: Request, access: CardAccess, user: CurrentUser, db: Db
) -> AttachmentMutated:
    """Attach a file or a link to a card (Sections 4.6 and 6.9).

    `Content-Length` is required and the cap enforced by `BodySizeLimitMiddleware` before the body
    is read (411 / 413); this handler only ever sees a body that fits.
    """
    branch = (
        _create_from_upload
        if request.headers.get("content-type", "").startswith(MULTIPART_PREFIX)
        else _create_from_link
    )
    result = await branch(request, db, user, board_id=access.board_id, card_id=card_id)
    return AttachmentMutated(
        item=AttachmentOut.model_validate(result.item), board_version=result.board_version
    )


@router.patch("/attachments/{attachment_id}", response_model=AttachmentMutated)
def rename_attachment(
    attachment_id: AttachmentId,
    body: AttachmentUpdateIn,
    access: AttachmentAccess,
    user: CurrentUser,
    db: Db,
) -> AttachmentMutated:
    """Rename an attachment's display name; the file on disk keeps its own (Section 4.6)."""
    result = service.rename_attachment(
        db, user, board_id=access.board_id, attachment_id=attachment_id, name=body.name
    )
    return AttachmentMutated(
        item=AttachmentOut.model_validate(result.item), board_version=result.board_version
    )


@router.delete("/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(
    attachment_id: AttachmentId, access: AttachmentAccess, user: CurrentUser, db: Db
) -> None:
    """Delete an attachment and its files, clearing the card's cover with it (Section 4.6)."""
    service.delete_attachment(db, user, board_id=access.board_id, attachment_id=attachment_id)


@router.put("/cards/{card_id}/cover", response_model=CardMutated)
def set_cover(
    card_id: CardId, body: CoverIn, access: CardAccess, user: CurrentUser, db: Db
) -> CardMutated:
    """Set a card's cover to a palette colour or one of its image attachments (Section 4.5)."""
    result = service.set_cover(
        db,
        user,
        board_id=access.board_id,
        card_id=card_id,
        kind=body.kind,
        value=body.value,
        size=body.size,
    )
    return CardMutated(
        item=CardSummary.model_validate(result.item), board_version=result.board_version
    )


@router.delete("/cards/{card_id}/cover", response_model=CardMutated)
def clear_cover(card_id: CardId, access: CardAccess, user: CurrentUser, db: Db) -> CardMutated:
    """Remove a card's cover (Section 4.5)."""
    result = service.clear_cover(db, user, board_id=access.board_id, card_id=card_id)
    return CardMutated(
        item=CardSummary.model_validate(result.item), board_version=result.board_version
    )
