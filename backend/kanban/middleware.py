"""Request identity and the access log (Section 6.11).

Outermost middleware in the stack: it stamps every response with `X-Request-Id`, publishes the
same id to the logging filter through a `ContextVar`, and writes the one access line per request
that replaces uvicorn's own (`method path status duration_ms user_id`).
"""

import logging
import secrets
import time
from contextvars import ContextVar

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("kanban.access")

#: Value used before any request is in flight (startup, shutdown, CLI).
NO_REQUEST_ID = "-"

_request_id: ContextVar[str] = ContextVar("kanban_request_id", default=NO_REQUEST_ID)


def get_request_id() -> str:
    """The current request's id, for the error envelope and the log filter."""
    return _request_id.get()


def new_request_id() -> str:
    """`req_` + 12 hex characters, e.g. `req_3f9a2c1d8b7e` (Section 4.1)."""
    return f"req_{secrets.token_hex(6)}"


class RequestIdMiddleware:
    """Pure ASGI: a `BaseHTTPMiddleware` would not see the status of a streamed response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = new_request_id()
        token = _request_id.set(request_id)
        started = time.perf_counter()
        status_code = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                MutableHeaders(scope=message)["X-Request-Id"] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = (time.perf_counter() - started) * 1000
            logger.info(
                "%s %s %s %.1fms user_id=%s",
                scope.get("method", "-"),
                scope.get("path", "-"),
                status_code,
                duration_ms,
                _resolved_user_id(scope),
            )
            _request_id.reset(token)


def _resolved_user_id(scope: Scope) -> str:
    """The authenticated user id when a dependency resolved one, `-` otherwise."""
    state = scope.get("state") or {}
    return str(state.get("user_id", NO_REQUEST_ID))
