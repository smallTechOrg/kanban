"""The request-body size boundary (Section 6.9).

Starlette parses a whole multipart body into a spooled file *before* the endpoint runs, so an
endpoint can never refuse a body that is still arriving. This pure-ASGI middleware is therefore
the real limit: it rejects an oversized `Content-Length` before a single byte is read, requires
that header on the upload routes, and wraps `receive` so a body that lies about its length is
aborted once it passes the cap.
"""

import re
from typing import Final

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from kanban.errors import ApiError, LengthRequired, TooLarge, error_response

#: Every `/api` route that is not an upload (Section 6.9).
DEFAULT_MAX_BYTES: Final[int] = 1024 * 1024

#: The one body larger than `DEFAULT_MAX_BYTES` the app accepts (Sections 4.11 and 6.9).
BACKGROUND_MAX_BYTES: Final[int] = 10 * 1024 * 1024

#: The one multipart route left: a board's background image (Section 4.11).
BACKGROUND_PATH: Final[re.Pattern[str]] = re.compile(r"^/api/boards/\d+/background/?$")


class BodySizeLimitMiddleware:
    """Cap the body of every request; the one upload route gets its own, larger cap."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        is_upload = _is_upload(path, scope.get("method", "GET"))
        limit = BACKGROUND_MAX_BYTES if is_upload else DEFAULT_MAX_BYTES

        content_length = _content_length(scope)
        if is_upload and content_length is None:
            await _reject(
                LengthRequired("length_required", "Uploads must send a Content-Length header."),
                scope,
                receive,
                send,
            )
            return
        if content_length is not None and content_length > limit:
            await _reject(_too_large(limit), scope, receive, send)
            return

        await self.app(scope, _capped(receive, limit, scope, send), send)


def _is_upload(path: str, method: str) -> bool:
    if method != "POST":
        return False
    return bool(BACKGROUND_PATH.match(path))


def _content_length(scope: Scope) -> int | None:
    for name, value in scope.get("headers", ()):
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None


def _too_large(limit: int) -> TooLarge:
    megabytes = limit / (1024 * 1024)
    return TooLarge("payload_too_large", f"Request body exceeds the {megabytes:.0f} MB limit.")


async def _reject(exc: ApiError, scope: Scope, receive: Receive, send: Send) -> None:
    """Answer with the error envelope without ever handing the body to the application."""
    await error_response(exc)(scope, receive, send)


def _capped(receive: Receive, limit: int, scope: Scope, send: Send) -> Receive:
    """Wrap `receive`, counting body bytes and aborting with 413 once they pass `limit`."""
    state = {"received": 0, "aborted": False}

    async def capped_receive() -> Message:
        if state["aborted"]:
            return {"type": "http.disconnect"}
        message = await receive()
        if message["type"] != "http.request":
            return message
        state["received"] += len(message.get("body", b""))
        if state["received"] > limit:
            state["aborted"] = True
            # Stop consuming the stream and answer; the server closes the connection.
            await error_response(_too_large(limit))(scope, receive, send)
            return {"type": "http.disconnect"}
        return message

    return capped_receive
