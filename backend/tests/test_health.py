"""The two endpoints that name no board, and the error envelope (Section 4.7)."""

from fastapi.testclient import TestClient

from kanban import __version__
from kanban.constants import (
    BOARD_COLORS,
    BOARD_GRADIENTS,
    LABEL_COLORS,
    LIST_COLORS,
)

META_FIELDS = (
    "version",
    "label_colors",
    "board_colors",
    "board_gradients",
    "list_colors",
)


def test_health_reports_the_documented_shape(api: TestClient) -> None:
    response = api.get("/api/health")

    assert response.status_code == 200
    payload = response.json()
    # `frontend_build` follows whether the SPA has been built, which the suite does not control.
    assert set(payload) == {"status", "db", "version", "frontend_build"}
    assert payload["status"] == "ok"
    assert payload["db"] == "ok"
    assert payload["version"] == __version__
    assert isinstance(payload["frontend_build"], bool)


def test_health_carries_a_request_id(api: TestClient) -> None:
    response = api.get("/api/health")

    assert response.headers["X-Request-Id"].startswith("req_")


def test_meta_has_every_documented_field(api: TestClient) -> None:
    payload = api.get("/api/meta").json()

    assert set(payload) == set(META_FIELDS)
    assert payload["version"] == __version__


def test_meta_serves_the_palettes_from_constants(api: TestClient) -> None:
    payload = api.get("/api/meta").json()

    assert payload["label_colors"] == LABEL_COLORS
    assert payload["board_colors"] == BOARD_COLORS
    assert payload["board_gradients"] == BOARD_GRADIENTS
    assert payload["list_colors"] == LIST_COLORS
    assert payload["label_colors"]["none"]["normal"] == "#091E420F"


def test_unknown_api_path_returns_the_error_envelope(api: TestClient) -> None:
    response = api.get("/api/does-not-exist")

    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "not_found"
    assert error["request_id"].startswith("req_")
