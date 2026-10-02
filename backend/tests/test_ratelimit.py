"""The one token bucket that guards `/api` (Sections 4.1 and 6.4 step 4).

A single-person install has nothing to brute-force, so `GLOBAL_RATE_LIMIT` is a runaway guard and
its whole allowance is six hundred requests a minute - more than a test can spend through
`TestClient` before the continuous refill outruns it. The bucket is therefore exercised directly,
as `test_db.py` exercises `write_tx` and `test_ordering.py` the position maths, and one narrowed
limiter stands in for the documented one to assert the 429 envelope the middleware answers with.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from kanban import ratelimit
from kanban.errors import RateLimited

#: Narrow enough that one test can empty it; `limiter_for` reads the module global every request,
#: so putting it there is all it takes to make the middleware count against it.
NARROW_RATE = "2/60"

A_CLIENT = "203.0.113.7"
ANOTHER_CLIENT = "203.0.113.8"


@pytest.fixture
def narrow_bucket(monkeypatch: pytest.MonkeyPatch) -> Iterator[ratelimit.RateLimiter]:
    """Put a two-request bucket in place of the documented one for the length of one test."""
    limiter = ratelimit.RateLimiter(NARROW_RATE)
    monkeypatch.setattr(ratelimit, "global_limiter", limiter)
    yield limiter


def test_the_documented_limit_is_six_hundred_requests_a_minute() -> None:
    assert ratelimit.parse_rate(ratelimit.GLOBAL_RATE_LIMIT) == (600, 60.0)
    assert ratelimit.global_limiter.capacity == 600
    assert ratelimit.global_limiter.refill_per_second == 10.0


@pytest.mark.parametrize("rate", ["600", "600/0", "0/60", "many/60", "600/soon"])
def test_a_mistyped_limit_raises_rather_than_meaning_no_limit(rate: str) -> None:
    with pytest.raises(ValueError, match="Invalid rate limit"):
        ratelimit.parse_rate(rate)


def test_an_empty_bucket_raises_with_whole_seconds_of_retry_after(
    narrow_bucket: ratelimit.RateLimiter,
) -> None:
    narrow_bucket.check(A_CLIENT)
    narrow_bucket.check(A_CLIENT)

    with pytest.raises(RateLimited) as refused:
        narrow_bucket.check(A_CLIENT)

    assert refused.value.code == "rate_limited"
    assert refused.value.retry_after is not None and refused.value.retry_after >= 1
    narrow_bucket.check(ANOTHER_CLIENT)  # one bucket per client, so another caller is unaffected


def test_reset_hands_the_whole_allowance_back(narrow_bucket: ratelimit.RateLimiter) -> None:
    """What the suite calls between tests, so one module never starves the next one."""
    narrow_bucket.check(A_CLIENT)
    narrow_bucket.check(A_CLIENT)

    ratelimit.reset_all()

    narrow_bucket.check(A_CLIENT)
    narrow_bucket.check(A_CLIENT)


def test_an_unaddressed_scope_counts_against_one_shared_key() -> None:
    """A test transport and a unix socket carry no client address (Section 6.12)."""
    assert ratelimit.client_ip({}) == ratelimit.UNKNOWN_CLIENT
    assert ratelimit.client_ip({"client": (A_CLIENT, 4321)}) == A_CLIENT


def test_only_api_paths_are_counted() -> None:
    """The SPA bundle and `/uploads` are served by the static layer, which is not limited."""
    assert ratelimit.limiter_for({"path": "/api/boards"}) is ratelimit.global_limiter
    assert ratelimit.limiter_for({"path": "/uploads/backgrounds/1.jpg"}) is None
    assert ratelimit.limiter_for({"path": "/b/1"}) is None


def test_the_middleware_answers_429_with_the_error_envelope(
    api: TestClient, narrow_bucket: ratelimit.RateLimiter
) -> None:
    """Refused in middleware, so an exhausted bucket costs no database work (Section 6.4)."""
    assert api.get("/api/meta").status_code == 200
    assert api.get("/api/meta").status_code == 200

    limited = api.get("/api/meta")

    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "rate_limited"
    assert limited.json()["error"]["request_id"].startswith("req_")
    assert int(limited.headers["Retry-After"]) >= 1
