"""The `ApiError` hierarchy and the exception handlers that render the error envelope.

This module is the only place an error reaches a client (CLAUDE.md section 3): services raise
`NotFound`, `Forbidden`, `Conflict`, `BadRequest`, ... and never `HTTPException`, and every
non-2xx `/api` or `/uploads` response has the body of Sections 4.1 and 6.10:

    {"error": {"code": ..., "message": ..., "details": ..., "request_id": ...}}
"""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from kanban.middleware import get_request_id
from kanban.schemas.common import ErrorBody, ErrorEnvelope

logger = logging.getLogger(__name__)

#: A Pydantic error list for 422, an object of context for an `ApiError`, `None` otherwise.
Details = list[dict[str, Any]] | dict[str, Any] | None

#: Status codes that carry no body of their own and therefore need a code to report.
_STATUS_CODES: dict[int, str] = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    405: "bad_request",
    409: "conflict",
    411: "length_required",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "validation_error",
    429: "rate_limited",
    503: "database_busy",
}


class ApiError(Exception):
    """Base of every error the API returns. Subclasses fix the status and the default code."""

    status: int = 500
    code: str = "internal_error"
    #: Seconds for a `Retry-After` header, when the status calls for one.
    retry_after: int | None = None

    def __init__(self, code: str | None = None, message: str = "", details: Details = None) -> None:
        super().__init__(message)
        self.code = code or type(self).code
        self.message = message
        self.details = details

    @property
    def headers(self) -> dict[str, str]:
        return {} if self.retry_after is None else {"Retry-After": str(self.retry_after)}


class BadRequest(ApiError):
    status = 400
    code = "bad_request"


class Unauthenticated(ApiError):
    status = 401
    code = "unauthenticated"


class Forbidden(ApiError):
    status = 403
    code = "forbidden"


class NotFound(ApiError):
    status = 404
    code = "not_found"


class Conflict(ApiError):
    status = 409
    code = "conflict"


class LengthRequired(ApiError):
    status = 411
    code = "length_required"


class TooLarge(ApiError):
    status = 413
    code = "payload_too_large"


class UnsupportedMediaType(ApiError):
    status = 415
    code = "unsupported_media_type"


class Unprocessable(ApiError):
    status = 422
    code = "validation_error"


class RateLimited(ApiError):
    status = 429
    code = "rate_limited"
    retry_after = 1


class Busy(ApiError):
    """`BEGIN IMMEDIATE` could not take the write lock within `busy_timeout` (Section 3.3)."""

    status = 503
    code = "database_busy"
    retry_after = 1


def error_response(exc: ApiError) -> JSONResponse:
    """Render one `ApiError` as the envelope. The single place that shape is built."""
    envelope = ErrorEnvelope(
        error=ErrorBody(
            code=exc.code,
            message=exc.message,
            details=exc.details,
            request_id=get_request_id(),
        )
    )
    return JSONResponse(
        status_code=exc.status,
        content=envelope.model_dump(mode="json"),
        headers=exc.headers,
    )


def is_locked_error(exc: OperationalError) -> bool:
    """True for the SQLite "database is locked" that a busy-timeout expiry raises."""
    return "locked" in str(exc.orig).lower()


def _first_validation_message(errors: list[dict[str, Any]]) -> str:
    """Build the Section 4.1 message shape: `title: String should have at least 1 character`."""
    if not errors:
        return "Request validation failed."
    first = errors[0]
    location = ".".join(str(part) for part in first.get("loc", ())[1:])
    message = str(first.get("msg", "Invalid value"))
    return f"{location}: {message}" if location else message


def register_exception_handlers(app: FastAPI) -> None:
    """Install every handler of the Section 6.10 table on the application."""

    @app.exception_handler(ApiError)
    async def _api_error(_request: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc)

    @app.exception_handler(RequestValidationError)
    async def _validation(_request: Request, exc: RequestValidationError) -> JSONResponse:
        errors: list[dict[str, Any]] = jsonable_encoder(exc.errors())
        return error_response(
            Unprocessable("validation_error", _first_validation_message(errors), errors)
        )

    @app.exception_handler(IntegrityError)
    async def _integrity(_request: Request, exc: IntegrityError) -> JSONResponse:
        logger.warning("Integrity error: %s", exc.orig)
        return error_response(Conflict("conflict", "That value is already taken."))

    @app.exception_handler(OperationalError)
    async def _operational(_request: Request, exc: OperationalError) -> JSONResponse:
        if is_locked_error(exc):
            return error_response(Busy("database_busy", "The board is busy, please retry."))
        logger.exception("Database error")
        return error_response(ApiError("internal_error", "Internal server error."))

    @app.exception_handler(StarletteHTTPException)
    async def _http(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _STATUS_CODES.get(exc.status_code, "internal_error")
        api_error = ApiError(code, str(exc.detail))
        api_error.status = exc.status_code
        return error_response(api_error)

    @app.exception_handler(Exception)
    async def _unhandled(_request: Request, _exc: Exception) -> JSONResponse:
        logger.exception("Unhandled exception")
        return error_response(ApiError("internal_error", "Internal server error."))
