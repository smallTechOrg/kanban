"""In-memory token buckets (Section 4.1 "Rate limiting", Section 6.4 step 4).

The server is deliberately single-process (the in-memory `BoardBus` and the single SQLite writer
both assume it), so no shared store is needed and a plain dict of buckets keyed by client IP is
the whole implementation. Two buckets exist:

* the **login bucket** - `KANBAN_LOGIN_RATE_LIMIT`, default 10 requests per 300 s - on
  `POST /api/auth/login` and `POST /api/auth/register`;
* the **global bucket** - 600 requests per 60 s - on every other `/api` route.

`RateLimitMiddleware` is the only caller: rejecting in middleware means an exhausted bucket costs
no database work and no body parsing. Exceeding a bucket returns 429 `rate_limited` with
`Retry-After` set to the whole seconds until the next token.
"""

import threading
import time
from dataclasses import dataclass
from math import ceil
from typing import Final

from starlette.types import ASGIApp, Receive, Scope, Send

from kanban.config import settings
from kanban.errors import RateLimited, error_response

#: Every `/api` route that is not login or register (Section 4.1).
GLOBAL_RATE_LIMIT: Final[str] = "600/60"

#: The two paths the login bucket guards, on POST only.
LOGIN_PATHS: Final[frozenset[str]] = frozenset({"/api/auth/login", "/api/auth/register"})

#: Only `/api` is limited; the SPA bundle and `/uploads` are served by the static layer.
_API_PREFIX: Final[str] = "/api"

#: A bucket untouched for this long is dropped, so the store cannot grow without bound.
_IDLE_EVICTION_SECONDS: Final[float] = 3600.0

#: Buckets are only swept once the store is big enough for the sweep to be worth its cost.
_EVICTION_THRESHOLD: Final[int] = 64

#: Used when the ASGI scope carries no client address (a test transport, or a unix socket).
UNKNOWN_CLIENT: Final[str] = "unknown"


def parse_rate(rate: str) -> tuple[int, float]:
    """Parse the `"<requests>/<seconds>"` form of `KANBAN_LOGIN_RATE_LIMIT` (Section 1.9).

    Raises `ValueError` for anything else, at import time, because a mistyped limit must not
    silently become "no limit".
    """
    requests, _, seconds = rate.partition("/")
    try:
        capacity, window = int(requests), float(seconds)
    except ValueError as exc:
        raise ValueError(f"Invalid rate limit {rate!r}; expected '<requests>/<seconds>'") from exc
    if capacity < 1 or window <= 0:
        raise ValueError(f"Invalid rate limit {rate!r}; both parts must be positive")
    return capacity, window


@dataclass
class _Bucket:
    """One client's remaining allowance and when it was last refilled (monotonic seconds)."""

    tokens: float
    updated: float


class RateLimiter:
    """A token bucket per key, refilled continuously at `capacity / window` tokens a second."""

    def __init__(self, rate: str) -> None:
        self.capacity, self.window = parse_rate(rate)
        self._buckets: dict[str, _Bucket] = {}
        # Mutating routes run in FastAPI's threadpool, so two requests can arrive here at once.
        self._lock = threading.Lock()
        _LIMITERS.append(self)

    @property
    def refill_per_second(self) -> float:
        return self.capacity / self.window

    def check(self, key: str) -> None:
        """Consume one token for `key`, or raise `RateLimited` with a `Retry-After` when empty."""
        now = time.monotonic()
        rate = self.refill_per_second
        with self._lock:
            self._evict(now)
            bucket = self._buckets.get(key)
            if bucket is None:
                self._buckets[key] = _Bucket(tokens=self.capacity - 1.0, updated=now)
                return
            bucket.tokens = min(self.capacity, bucket.tokens + (now - bucket.updated) * rate)
            bucket.updated = now
            if bucket.tokens < 1.0:
                raise _rate_limited(ceil((1.0 - bucket.tokens) / rate))
            bucket.tokens -= 1.0

    def reset(self) -> None:
        """Forget every bucket. The test suite calls it between tests; nothing else does."""
        with self._lock:
            self._buckets.clear()

    def _evict(self, now: float) -> None:
        """Drop buckets nobody has touched for an hour; called with the lock held."""
        if len(self._buckets) <= _EVICTION_THRESHOLD:
            return
        stale = [
            key
            for key, bucket in self._buckets.items()
            if now - bucket.updated > _IDLE_EVICTION_SECONDS
        ]
        for key in stale:
            del self._buckets[key]


def _rate_limited(retry_after: int) -> RateLimited:
    """The 429 `rate_limited` error, carrying whole seconds in `Retry-After` (Section 4.1)."""
    error = RateLimited("rate_limited", "Too many requests, please wait and try again.")
    error.retry_after = max(1, retry_after)
    return error


#: Every limiter ever built, so `reset_all()` can empty them in one call.
_LIMITERS: Final[list[RateLimiter]] = []

#: The two documented buckets. Module level, because the limit is process-wide by design.
login_limiter = RateLimiter(settings.login_rate_limit)
global_limiter = RateLimiter(GLOBAL_RATE_LIMIT)


def reset_all() -> None:
    """Empty every bucket, so one test module's attempts never starve the next one's."""
    for limiter in _LIMITERS:
        limiter.reset()


def client_ip(scope: Scope) -> str:
    """The key every bucket is counted against.

    uvicorn is run behind a reverse proxy with `--proxy-headers`, which rewrites `scope["client"]`
    to the forwarded address, so no header parsing belongs here (Section 6.12).
    """
    client = scope.get("client")
    return client[0] if client else UNKNOWN_CLIENT


def limiter_for(scope: Scope) -> RateLimiter | None:
    """The bucket that guards this request, or None when the path is not rate limited."""
    path: str = scope.get("path", "")
    if not path.startswith(_API_PREFIX):
        return None
    if scope.get("method", "GET").upper() == "POST" and path.rstrip("/") in LOGIN_PATHS:
        return login_limiter
    return global_limiter


class RateLimitMiddleware:
    """Pure ASGI (Section 6.4 step 4): answers 429 before any dependency or body is touched."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limiter = limiter_for(scope)
        if limiter is not None:
            try:
                limiter.check(client_ip(scope))
            except RateLimited as exc:
                await error_response(exc)(scope, receive, send)
                return
        await self.app(scope, receive, send)
