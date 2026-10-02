"""Logging configuration (Section 6.11).

One stdout stream handler, one line per record, every line carrying the request id set by
`RequestIdMiddleware`. `KANBAN_LOG_FORMAT=json` swaps the formatter for one JSON object per line
without changing anything else. uvicorn's own access log is disabled: the middleware writes it.
"""

import json
import logging
import logging.config
import sys
from typing import Any

from kanban.config import Settings
from kanban.middleware import get_request_id

TEXT_FORMAT = "%(asctime)s %(levelname)s %(name)s rid=%(request_id)s %(message)s"


class RequestIdFilter(logging.Filter):
    """Copy the request-id ContextVar onto every record so both formatters can use it."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per line, for log shippers."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "time": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", "-"),
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(settings: Settings) -> None:
    """Install the dictConfig. Called once by `create_app()`."""
    level = settings.resolved_log_level
    formatter: dict[str, Any] = (
        {"()": f"{__name__}.JsonFormatter"}
        if settings.log_format == "json"
        else {"format": TEXT_FORMAT}
    )
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": {"request_id": {"()": f"{__name__}.RequestIdFilter"}},
            "formatters": {"default": formatter},
            "handlers": {
                "stdout": {
                    "class": "logging.StreamHandler",
                    "stream": sys.stdout,
                    "formatter": "default",
                    "filters": ["request_id"],
                }
            },
            "loggers": {
                "kanban": {"handlers": ["stdout"], "level": level, "propagate": False},
                "uvicorn": {"handlers": ["stdout"], "level": level, "propagate": False},
                "uvicorn.error": {"handlers": ["stdout"], "level": level, "propagate": False},
                # RequestIdMiddleware emits the one access line per request instead.
                "uvicorn.access": {"handlers": [], "level": "CRITICAL", "propagate": False},
                "alembic": {"handlers": ["stdout"], "level": "INFO", "propagate": False},
                "sqlalchemy.engine": {
                    "handlers": ["stdout"],
                    "level": "INFO" if settings.sql_echo else "WARNING",
                    "propagate": False,
                },
            },
            "root": {"handlers": ["stdout"], "level": "WARNING"},
        }
    )
