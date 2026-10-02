"""Board resolution and the closed-board guard (Sections 4.1 and 6.6).

My Day is a single-person install: there is no account, no session and no role, so there is
nothing here to authenticate a caller *as*. What is left is the one rule that still decides
whether a request may proceed, and this module is its single source of truth (CLAUDE.md
section 3): no service re-reads a board to decide what a request may do.

It owns

* `board_access()`, which loads the board a `/api/boards/{board_id}` route names, answers 404
  `not_found` when there is none and 409 `conflict` "Board is closed" for a mutation on a closed
  board. `allow_closed` exempts the routes that must keep working while a board is closed -
  reopen and board delete (Section 4.1). Reads are never refused;
* the four child-row factories - `list_access`, `card_access`, `label_access`, `item_access` -
  which resolve a child row's board and then apply that same check, so a `/api/cards/{card_id}`
  route holds no SELECT of its own (CLAUDE.md section 8);
* `CsrfHeaderMiddleware`. It is the one guard that survives the removal of accounts, and for a
  different reason than it was written: with the API open to whatever can reach the port, the
  `X-Requested-With: fetch` header is what stops a web page the reader happens to be visiting
  from POSTing to `http://localhost:8000/api/...` in the background. A cross-origin `fetch`
  cannot set it without a preflight the server never answers.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Final

from fastapi import Depends, Path, Request
from sqlalchemy import Select, select
from sqlalchemy.orm import Session
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from kanban.db import get_db
from kanban.errors import Conflict, Forbidden, NotFound, error_response
from kanban.models import Board, Card, CardItem, Label, List

#: The header every `/api` mutation must carry (Section 4.1).
CSRF_HEADER: Final[str] = "X-Requested-With"
CSRF_HEADER_VALUE: Final[str] = "fetch"

#: Methods the CSRF guard and the closed-board guard treat as mutations.
UNSAFE_METHODS: Final[frozenset[str]] = frozenset({"POST", "PUT", "PATCH", "DELETE"})

#: Only `/api` is guarded; the SPA, `/assets` and `/uploads` carry no mutations.
_API_PREFIX: Final[str] = "/api"


@dataclass(frozen=True)
class BoardCtx:
    """What `board_access` resolves: the board row the request names."""

    board: Board

    @property
    def board_id(self) -> int:
        return self.board.id


#: What a `/api/{resource}/{id}` route binds its row id as.
PathId = Annotated[int, Path(ge=1)]
#: What every dependency below asks for its session with.
Db = Annotated[Session, Depends(get_db)]


def board_access(*, allow_closed: bool = False) -> Callable[..., BoardCtx]:
    """Build the dependency that resolves the board a route names (Section 6.6).

    404 `not_found` when the board does not exist; 409 `conflict` "Board is closed" for a
    mutation on a closed board unless `allow_closed`.
    """

    def dependency(request: Request, board_id: PathId, db: Db) -> BoardCtx:
        board = db.get(Board, board_id)
        if board is None:
            raise NotFound("not_found", "Board not found.")
        if board.is_closed and not allow_closed and _is_mutation(request.method):
            raise Conflict("conflict", "Board is closed", {"board_id": board_id})
        return BoardCtx(board=board)

    return dependency


def _board_id_of(db: Session, statement: Select[tuple[int]], *, missing: str) -> int:
    """The board a child row belongs to, for the factories below (step 4 of Section 6.7.2).

    One statement selecting one column, because the dependency needs the board id and nothing
    else. A row that is not there raises `NotFound` (404 `not_found`) with `missing` as the
    message, exactly as `board_access` answers for a board that is not there.
    """
    board_id = db.execute(statement).scalar_one_or_none()
    if board_id is None:
        raise NotFound("not_found", missing)
    return int(board_id)


def list_access() -> Callable[..., BoardCtx]:
    """Build the dependency of a `/api/lists/{list_id}` route (Sections 4.1 and 6.6).

    The list's board is resolved first and then handed to `board_access()`, so the
    closed-board rule is checked by the one dependency every `/api/boards/...` route uses
    (CLAUDE.md section 3).
    """
    check = board_access()

    def dependency(request: Request, list_id: PathId, db: Db) -> BoardCtx:
        board_id = _board_id_of(
            db,
            select(List.board_id).where(List.id == list_id),
            missing="That list does not exist.",
        )
        return check(request=request, board_id=board_id, db=db)

    return dependency


def card_access() -> Callable[..., BoardCtx]:
    """Build the dependency of a `/api/cards/{card_id}` route (step 4 of Section 6.7.2)."""
    check = board_access()

    def dependency(request: Request, card_id: PathId, db: Db) -> BoardCtx:
        board_id = _board_id_of(
            db,
            select(Card.board_id).where(Card.id == card_id),
            missing="That card does not exist.",
        )
        return check(request=request, board_id=board_id, db=db)

    return dependency


def label_access() -> Callable[..., BoardCtx]:
    """Build the dependency of a `/api/labels/{label_id}` route (Section 4.3).

    A label carries its `board_id`, so this is the one factory whose resolve needs no join.
    """
    check = board_access()

    def dependency(request: Request, label_id: PathId, db: Db) -> BoardCtx:
        board_id = _board_id_of(
            db,
            select(Label.board_id).where(Label.id == label_id),
            missing="That label does not exist.",
        )
        return check(request=request, board_id=board_id, db=db)

    return dependency


def item_access() -> Callable[..., BoardCtx]:
    """Build the dependency of a `/api/card-items/{item_id}` route (Section 4.6)."""
    check = board_access()

    def dependency(request: Request, item_id: PathId, db: Db) -> BoardCtx:
        board_id = _board_id_of(
            db,
            select(Card.board_id)
            .join(CardItem, CardItem.card_id == Card.id)
            .where(CardItem.id == item_id),
            missing="That item does not exist.",
        )
        return check(request=request, board_id=board_id, db=db)

    return dependency


def _is_mutation(method: str) -> bool:
    return method.upper() in UNSAFE_METHODS


# --------------------------------------------------------------------------- CSRF


class CsrfHeaderMiddleware:
    """Refuse `/api` mutations that do not carry `X-Requested-With: fetch` (Section 4.1).

    Pure ASGI, mounted between the rate limiter and the body-size limit (Section 6.4 step 5), so
    the body of a request that is about to be refused is never parsed.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and self._is_refused(scope):
            forbidden = Forbidden(
                "csrf_header_missing", f"{CSRF_HEADER}: {CSRF_HEADER_VALUE} is required."
            )
            await error_response(forbidden)(scope, receive, send)
            return
        await self.app(scope, receive, send)

    def _is_refused(self, scope: Scope) -> bool:
        if scope.get("method", "GET").upper() not in UNSAFE_METHODS:
            return False
        if not scope.get("path", "").startswith(_API_PREFIX):
            return False
        headers = Headers(scope=scope)
        return headers.get(CSRF_HEADER, "").strip().lower() != CSRF_HEADER_VALUE
