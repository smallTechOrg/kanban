"""`POST /api/boards/{board_id}/background`, `GET /api/boards/{board_id}/backgrounds` and the
`/uploads/backgrounds/...` half of `GET /uploads/{path}` (Sections 4.3, 4.11 and 6.9).

Everything runs through the public API (CLAUDE.md section 6). The disk is inspected only where a
test is *about* it - that an upload really lands in `data/uploads/backgrounds/` under the id, and
that the preview really is the documented 400x240 - which is the one thing no response can show.
The board-background cap is the 10 MB of Section 6.9; every other body is capped at 1 MB.
"""

import io
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from kanban import storage
from kanban.bodylimit import BACKGROUND_MAX_BYTES
from kanban.config import settings
from kanban.constants import BOARD_COLORS, BOARD_GRADIENTS
from kanban.storage import BACKGROUND_THUMB_SIZE
from tests.conftest import CSRF_HEADERS

BoardFactory = Callable[..., dict[str, Any]]

#: One byte past the 10 MB Section 6.9 caps a background at, which the middleware refuses unread.
OVER_CAP_BYTES = BACKGROUND_MAX_BYTES + 1


# --------------------------------------------------------------------------- helpers


#: A file whose magic number says `application/pdf`: the one type a background may never be.
PDF_BYTES = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n"


def png_bytes(
    size: tuple[int, int] = (320, 200), color: tuple[int, int, int] = (9, 120, 200)
) -> bytes:
    """A real PNG, so Pillow's own `Image.open().format` is what decides the type."""
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


def webp_bytes(size: tuple[int, int] = (640, 400)) -> bytes:
    """A real WebP, the third type Section 6.9 allows a background to be."""
    buffer = io.BytesIO()
    Image.new("RGB", size, (81, 152, 57)).save(buffer, format="WEBP")
    return buffer.getvalue()


def upload(
    api: TestClient,
    board_id: int,
    *,
    filename: str = "beach.png",
    content: bytes | None = None,
    content_type: str = "image/png",
) -> Any:
    """`POST /api/boards/{board_id}/background` as multipart, returning the raw response."""
    body = png_bytes() if content is None else content
    return api.post(
        f"/api/boards/{board_id}/background",
        files={"file": (filename, body, content_type)},
        headers=CSRF_HEADERS,
    )


def upload_item(api: TestClient, board_id: int, **kwargs: Any) -> dict[str, Any]:
    """One successful upload's `BoardSummary`."""
    response = upload(api, board_id, **kwargs)
    assert response.status_code == 200, response.text
    return response.json()["item"]


def backgrounds(api: TestClient, board_id: int) -> dict[str, Any]:
    """`GET /api/boards/{board_id}/backgrounds`: the presets plus the caller's own library."""
    response = api.get(f"/api/boards/{board_id}/backgrounds")
    assert response.status_code == 200, response.text
    return response.json()


def patch_board(api: TestClient, board_id: int, **body: Any) -> Any:
    """`PATCH /api/boards/{board_id}`, returning the raw response."""
    return api.patch(f"/api/boards/{board_id}", json=body, headers=CSRF_HEADERS)


def stored(background_id: int, name: str) -> Path:
    """One file of `data/uploads/backgrounds/`, as Section 3.11 names it."""
    return settings.uploads_dir / "backgrounds" / name.format(id=background_id)


def image_id(item: dict[str, Any]) -> int:
    """The `background_image_id` a board summary points at, asserted present."""
    background_id = item["background_value"].rsplit("/", 1)[1].split(".", 1)[0]
    return int(background_id)


# --------------------------------------------------------------------------- upload


def test_upload_sets_the_board_background_and_returns_a_thumbnail_url(
    api: TestClient, board: dict[str, Any]
) -> None:
    """The documented 200 `Mutated<BoardSummary>` with the three background columns written."""

    response = upload(api, board["id"])

    assert response.status_code == 200, response.text
    body = response.json()
    item = body["item"]
    background_id = image_id(item)
    assert item["background_type"] == "image"
    assert item["background_value"] == f"/uploads/backgrounds/{background_id}.png"
    assert item["background_thumb_url"] == f"/uploads/backgrounds/{background_id}.thumb.jpg"
    assert body["board_version"] == item["version"] > board["version"]


def test_upload_stores_the_original_and_a_400x240_preview(
    api: TestClient, board: dict[str, Any]
) -> None:
    """Section 3.11's two files, named after the row's id, with the preview Pillow cropped."""

    background_id = image_id(upload_item(api, board["id"]))

    original = stored(background_id, "{id}.png")
    preview = stored(background_id, "{id}.thumb.jpg")
    assert original.is_file()
    with Image.open(preview) as thumb:
        assert thumb.size == BACKGROUND_THUMB_SIZE


def test_upload_records_one_background_changed_activity(
    api: TestClient, board: dict[str, Any]
) -> None:
    upload_item(api, board["id"])

    feed = api.get(f"/api/boards/{board['id']}/activity").json()["items"]
    assert feed[0]["type"] == "board.background_changed"
    assert feed[0]["data"]["background_type"] == "image"


def test_upload_accepts_webp_and_stores_its_own_extension(
    api: TestClient, board: dict[str, Any]
) -> None:
    """The extension follows the *sniffed* type, not the filename (Section 6.9)."""

    item = upload_item(api, board["id"], filename="photo.png", content=webp_bytes())

    assert item["background_value"].endswith(".webp")


def test_upload_of_a_non_image_is_415(api: TestClient, board: dict[str, Any]) -> None:
    """A PDF dressed as a PNG: the type comes from Pillow, so the header does not save it."""

    response = upload(api, board["id"], filename="notes.png", content=PDF_BYTES)

    assert response.status_code == 415, response.text
    assert response.json()["error"]["code"] == "unsupported_media_type"
    assert api.get(f"/api/boards/{board['id']}").json()["board"]["background_type"] == "color"


def test_upload_leaves_no_temp_file_behind_when_it_is_refused(
    api: TestClient, board: dict[str, Any]
) -> None:
    """Section 6.9's "any failure deletes the files": `tmp/` is empty after a 415."""

    assert upload(api, board["id"], content=PDF_BYTES).status_code == 415

    tmp = settings.uploads_dir / "tmp"
    assert not tmp.is_dir() or list(tmp.iterdir()) == []


def test_a_failed_transaction_rolls_back_and_takes_the_renamed_files_with_it(
    api: TestClient, board: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Section 6.9's "any failure rolls back and deletes the files", after the rename.

    The one failure the write order is designed around: the files are already in
    `backgrounds/{id}.*` when the transaction dies, so the row must go *and* so must they -
    otherwise the crash leaves a file the library will never list and nothing will ever delete.
    """
    before = backgrounds(api, board["id"])["custom"]
    placed: list[int] = []
    real_place = storage.place_background

    def exploding_place(background_id: int, prepared: storage.PreparedBackground) -> Any:
        real_place(background_id, prepared)
        placed.append(background_id)
        raise OSError("the disk filled up between the rename and the commit")

    monkeypatch.setattr(storage, "place_background", exploding_place)

    with pytest.raises(OSError):
        upload(api, board["id"])

    assert placed, "the rename must have happened for this test to be about anything"
    assert not stored(placed[0], "{id}.png").exists()
    assert not stored(placed[0], "{id}.thumb.jpg").exists()
    assert backgrounds(api, board["id"])["custom"] == before
    assert api.get(f"/api/boards/{board['id']}").json()["board"]["background_type"] == "color"


def test_upload_over_the_10mb_cap_is_413(api: TestClient, board: dict[str, Any]) -> None:
    """`BodySizeLimitMiddleware` refuses the body before a byte of it is read (Section 6.9)."""

    response = upload(api, board["id"], filename="huge.png", content=bytes(OVER_CAP_BYTES))

    assert response.status_code == 413, response.text
    assert response.json()["error"]["code"] == "payload_too_large"


def test_upload_without_a_content_length_is_411(api: TestClient, board: dict[str, Any]) -> None:
    """An upload must declare its length so the cap can be applied unread (Section 6.9)."""

    response = api.post(
        f"/api/boards/{board['id']}/background",
        content=iter([b"--boundary--\r\n"]),
        headers={**CSRF_HEADERS, "Content-Type": "multipart/form-data; boundary=boundary"},
    )

    assert response.status_code == 411, response.text
    assert response.json()["error"]["code"] == "length_required"


def test_upload_without_a_file_field_is_422(api: TestClient, board: dict[str, Any]) -> None:
    response = api.post(
        f"/api/boards/{board['id']}/background",
        files={"wrong": ("beach.png", png_bytes(), "image/png")},
        headers=CSRF_HEADERS,
    )

    assert response.status_code == 422, response.text


# --------------------------------------------------------------------------- access


def test_uploading_to_a_board_that_does_not_exist_is_404(api: TestClient) -> None:
    """`board_access` answers before the upload is read at all (Sections 6.4 and 6.6)."""
    response = upload(api, 424242)

    assert response.status_code == 404, response.text
    assert response.json()["error"]["code"] == "not_found"


def test_uploading_to_a_closed_board_is_409(api: TestClient, board_factory: BoardFactory) -> None:
    board = board_factory("Closing soon")
    assert api.post(f"/api/boards/{board['id']}/close", headers=CSRF_HEADERS).status_code == 200

    response = upload(api, board["id"])

    assert response.status_code == 409, response.text


# --------------------------------------------------------------------------- the library


def test_the_library_lists_the_presets_and_every_uploaded_image(
    api: TestClient, board: dict[str, Any], board_factory: BoardFactory
) -> None:
    """`custom[]` is the whole `board_backgrounds` table: one install, one library (Section 4.3)."""
    elsewhere = board_factory("Another board")
    here = image_id(upload_item(api, board["id"]))
    there = image_id(upload_item(api, elsewhere["id"]))

    body = backgrounds(api, board["id"])

    assert [row["key"] for row in body["colors"]] == list(BOARD_COLORS)
    assert [row["key"] for row in body["gradients"]] == list(BOARD_GRADIENTS)
    ids = [row["id"] for row in body["custom"]]
    # An image no board wears any more is still in the library, so `there` is listed here too.
    assert {here, there} <= set(ids)


def test_a_library_image_can_be_reselected_and_a_colour_clears_it(
    api: TestClient, board_factory: BoardFactory
) -> None:
    """Section 4.3: a colour or gradient clears `background_image_id`; the image stays listed."""
    board = board_factory("Repainted")
    background_id = image_id(upload_item(api, board["id"]))

    cleared = patch_board(
        api, board["id"], background_type="color", background_value=BOARD_COLORS["clay"]
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["item"]["background_thumb_url"] is None
    assert cleared.json()["item"]["background_value"] == BOARD_COLORS["clay"]

    reselected = patch_board(api, board["id"], background_image_id=background_id)
    assert reselected.status_code == 200, reselected.text
    item = reselected.json()["item"]
    assert item["background_type"] == "image"
    assert item["background_thumb_url"] == f"/uploads/backgrounds/{background_id}.thumb.jpg"
    assert background_id in [row["id"] for row in backgrounds(api, board["id"])["custom"]]


def test_a_gradient_also_clears_the_image_reference(
    api: TestClient, board_factory: BoardFactory
) -> None:
    board = board_factory("Gradient board")
    upload_item(api, board["id"])

    response = patch_board(
        api, board["id"], background_type="gradient", background_value="gradient-dusk"
    )

    assert response.status_code == 200, response.text
    assert response.json()["item"]["background_thumb_url"] is None
    assert response.json()["item"]["background_value"] == "gradient-dusk"


def test_selecting_an_image_that_is_not_in_the_library_is_404(
    api: TestClient, board: dict[str, Any]
) -> None:
    """`background_image_id` must name a `board_backgrounds` row (Section 4.3)."""
    response = patch_board(api, board["id"], background_image_id=424242)

    assert response.status_code == 404, response.text
    assert response.json()["error"]["code"] == "not_found"


# --------------------------------------------------------------------------- serving


@pytest.mark.parametrize("name", ["{id}.png", "{id}.thumb.jpg"])
def test_a_background_and_its_thumbnail_are_served_inline(
    api: TestClient, board: dict[str, Any], name: str
) -> None:
    """Section 6.9: the `board_backgrounds` row is what makes the file servable."""
    background_id = image_id(upload_item(api, board["id"]))

    response = api.get(f"/uploads/backgrounds/{name.format(id=background_id)}")

    assert response.status_code == 200, response.text
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Content-Disposition"].startswith("inline")


def test_a_missing_background_file_is_404(api: TestClient, board: dict[str, Any]) -> None:
    assert api.get("/uploads/backgrounds/999999.png").status_code == 404
