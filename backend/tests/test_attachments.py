"""`/api/cards/{card_id}/attachments`, `/api/attachments/{id}`, `/api/cards/{card_id}/cover`
and `GET /uploads/{path}` (Sections 4.5, 4.6, 4.11 and 6.9).

Everything runs through the public API (CLAUDE.md section 6): the card is created with the
composer, and a stored file is only ever inspected where the test is *about* the disk - that an
upload really lands in `data/uploads/attachments/{id}/` and that deleting the row really removes
it - which is the one thing no response can show. The two helpers borrowed from `test_cards.py`
(`create_card`, `list_ids`) are the ones that module documents.
"""

import io
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from kanban.config import settings
from kanban.storage import THUMB_SIZE
from tests.conftest import CSRF_HEADERS
from tests.test_cards import create_card, list_ids

BoardFactory = Callable[..., dict[str, Any]]

#: A body larger than `KANBAN_MAX_UPLOAD_MB` (25), which the middleware refuses unread.
OVER_CAP_BYTES = (settings.max_upload_mb + 1) * 1024 * 1024

#: The first bytes of a PDF and of a file no magic number matches (Section 3.11).
PDF_BYTES = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n"
OPAQUE_BYTES = b"\x07\x08\x09" + bytes(64)

#: A PNG signature with nothing behind it: the magic table says `image/png`, Pillow disagrees.
BROKEN_PNG_BYTES = b"\x89PNG\r\n\x1a\n" + bytes(32)


# --------------------------------------------------------------------------- fixtures


@pytest.fixture
def card(api: TestClient, board: dict[str, Any]) -> dict[str, Any]:
    """One card in the seeded `To Do` list, which every attachment here hangs off."""
    return create_card(api, list_ids(board["id"])[0], "Design home page")["item"]


# --------------------------------------------------------------------------- helpers


def png_bytes(
    size: tuple[int, int] = (320, 200), color: tuple[int, int, int] = (9, 120, 200)
) -> bytes:
    """A real PNG, so Pillow's own `Image.open().format` is what decides the type."""
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


def rgba_png_bytes(size: tuple[int, int] = (120, 120)) -> bytes:
    """A fully transparent PNG, which is what `storage._flattened` exists for."""
    buffer = io.BytesIO()
    Image.new("RGBA", size, (9, 120, 200, 0)).save(buffer, format="PNG")
    return buffer.getvalue()


def upload(
    api: TestClient,
    card_id: int,
    *,
    filename: str = "photo.png",
    content: bytes | None = None,
    content_type: str = "image/png",
) -> Any:
    """`POST /api/cards/{card_id}/attachments` as multipart, returning the raw response."""
    body = png_bytes() if content is None else content
    return api.post(
        f"/api/cards/{card_id}/attachments",
        files={"file": (filename, body, content_type)},
        headers=CSRF_HEADERS,
    )


def upload_item(api: TestClient, card_id: int, **kwargs: Any) -> dict[str, Any]:
    """One successful upload's `AttachmentOut`."""
    response = upload(api, card_id, **kwargs)
    assert response.status_code == 201, response.text
    return response.json()["item"]


def link_item(api: TestClient, card_id: int, url: str, **body: Any) -> dict[str, Any]:
    """One successful link attachment's `AttachmentOut` (the JSON branch of the same path)."""
    response = api.post(
        f"/api/cards/{card_id}/attachments", json={"url": url, **body}, headers=CSRF_HEADERS
    )
    assert response.status_code == 201, response.text
    return response.json()["item"]


def stored(attachment_id: int) -> Path:
    """The directory Section 3.11 says an upload lands in."""
    return settings.uploads_dir / "attachments" / str(attachment_id)


def card_body(api: TestClient, card_id: int) -> dict[str, Any]:
    """`GET /api/cards/{card_id}`, which is how the cover is read back."""
    response = api.get(f"/api/cards/{card_id}")
    assert response.status_code == 200, response.text
    return response.json()


def set_cover(api: TestClient, card_id: int, **body: Any) -> Any:
    """`PUT /api/cards/{card_id}/cover`, returning the raw response."""
    return api.put(f"/api/cards/{card_id}/cover", json=body, headers=CSRF_HEADERS)


def feed_types(api: TestClient, card: dict[str, Any]) -> list[str]:
    """Every activity `type` on the card's feed, newest first (Sections 4.3 and 4.5)."""
    response = api.get(f"/api/boards/{card['board_id']}/activity", params={"card_id": card["id"]})
    assert response.status_code == 200, response.text
    return [row["type"] for row in response.json()["items"]]


# --------------------------------------------------------------------------- uploads


def test_upload_stores_the_file_and_a_two_to_one_thumbnail(
    api: TestClient, card: dict[str, Any]
) -> None:
    item = upload_item(api, card["id"], filename="photo.png")

    assert item["kind"] == "upload"
    assert item["name"] == "photo.png"
    assert item["mime_type"] == "image/png"
    assert item["is_image"] is True
    assert item["is_cover"] is False
    assert item["size_bytes"] == len(png_bytes())
    assert item["url"] == f"/uploads/attachments/{item['id']}/photo.png"
    assert item["thumb_url"] == f"/uploads/attachments/{item['id']}/thumb.jpg"
    assert item["dominant_color"] is not None
    assert item["dominant_color"].startswith("#") and len(item["dominant_color"]) == 7

    directory = stored(item["id"])
    assert (directory / "photo.png").is_file()
    with Image.open(directory / "thumb.jpg") as thumb:
        assert thumb.size == THUMB_SIZE
        assert thumb.format == "JPEG"
    assert "attachment.added" in feed_types(api, card)


def test_upload_sanitises_the_filename_and_the_reserved_device_names(
    api: TestClient, card: dict[str, Any]
) -> None:
    traversal = upload_item(api, card["id"], filename="../../My Photo!!.png")
    reserved = upload_item(api, card["id"], filename="NUL.png")
    dots = upload_item(api, card["id"], filename="..")

    assert traversal["url"] == f"/uploads/attachments/{traversal['id']}/My_Photo__.png"
    assert reserved["url"] == f"/uploads/attachments/{reserved['id']}/_NUL.png"
    assert dots["url"] == f"/uploads/attachments/{dots['id']}/file"
    # The display name is the client's, unchanged; only the disk name is sanitised.
    assert traversal["name"] == "../../My Photo!!.png"
    assert stored(traversal["id"]).joinpath("My_Photo__.png").is_file()


def test_upload_type_is_sniffed_from_the_content_not_the_header(
    api: TestClient, card: dict[str, Any]
) -> None:
    pdf = upload_item(api, card["id"], filename="brief.pdf", content=PDF_BYTES)
    lying = upload_item(api, card["id"], filename="photo.png", content=PDF_BYTES)
    opaque = upload_item(api, card["id"], filename="blob.bin", content=OPAQUE_BYTES)

    assert pdf["mime_type"] == "application/pdf"
    assert pdf["is_image"] is False
    assert pdf["thumb_url"] is None
    assert lying["mime_type"] == "application/pdf"  # the .png name is not evidence
    assert opaque["mime_type"] == "application/octet-stream"
    assert not stored(pdf["id"]).joinpath("thumb.jpg").exists()


def test_a_transparent_image_gets_a_thumbnail_over_white(
    api: TestClient, card: dict[str, Any]
) -> None:
    item = upload_item(api, card["id"], filename="logo.png", content=rgba_png_bytes())

    # Compositing onto white is what keeps a logo-on-nothing PNG from becoming a black box.
    assert item["is_image"] is True
    assert item["dominant_color"] == "#FFFFFF"
    with Image.open(stored(item["id"]) / "thumb.jpg") as thumb:
        assert thumb.size == THUMB_SIZE


def test_a_broken_image_is_stored_as_a_plain_file(api: TestClient, card: dict[str, Any]) -> None:
    item = upload_item(api, card["id"], filename="truncated.png", content=BROKEN_PNG_BYTES)

    # Sniffed as a PNG by its magic number, but Pillow cannot open it, so there is no thumbnail
    # and no cover: `is_image` means "has a thumbnail a cover can use" (Section 6.9).
    assert item["mime_type"] == "image/png"
    assert item["is_image"] is False
    assert item["thumb_url"] is None
    assert item["dominant_color"] is None
    assert set_cover(api, card["id"], kind="attachment", value=item["id"]).status_code == 400


def test_upload_over_the_cap_is_413(api: TestClient, card: dict[str, Any]) -> None:
    response = upload(api, card["id"], filename="huge.bin", content=bytes(OVER_CAP_BYTES))

    assert response.status_code == 413, response.text
    assert response.json()["error"]["code"] == "payload_too_large"


def test_a_body_with_no_file_and_no_link_is_422(api: TestClient, card: dict[str, Any]) -> None:
    path = f"/api/cards/{card['id']}/attachments"

    # A real multipart body whose one part is not called `file`, and a body that is neither.
    wrong_field = api.post(path, files={"nope": ("x.txt", b"x")}, headers=CSRF_HEADERS)
    not_json = api.post(path, data={"nope": "1"}, headers=CSRF_HEADERS)

    assert wrong_field.status_code == 422, wrong_field.text
    assert wrong_field.json()["error"]["message"] == "file: Field required"
    assert not_json.status_code == 422, not_json.text
    assert not_json.json()["error"]["code"] == "validation_error"


def test_an_unknown_attachment_id_is_404(api: TestClient, card: dict[str, Any]) -> None:
    unknown = upload_item(api, card["id"], filename="photo.png")["id"] + 10_000

    assert (
        api.patch(
            f"/api/attachments/{unknown}", json={"name": "x"}, headers=CSRF_HEADERS
        ).status_code
        == 404
    )
    assert api.delete(f"/api/attachments/{unknown}", headers=CSRF_HEADERS).status_code == 404


# --------------------------------------------------------------------------- links


def test_link_attachment_needs_no_file(api: TestClient, card: dict[str, Any]) -> None:
    item = link_item(api, card["id"], "https://example.com/specs/plan.pdf")

    assert item["kind"] == "link"
    assert item["name"] == "example.com"  # the host is the default display text
    assert item["url"] == "https://example.com/specs/plan.pdf"
    assert item["is_image"] is False
    assert item["thumb_url"] is None
    assert item["size_bytes"] is None
    assert not stored(item["id"]).exists()


def test_link_display_text_is_kept_and_a_non_http_url_is_422(
    api: TestClient, card: dict[str, Any]
) -> None:
    named = link_item(api, card["id"], "https://example.com/", name="The spec")
    refused = api.post(
        f"/api/cards/{card['id']}/attachments",
        json={"url": "javascript:alert(1)"},
        headers=CSRF_HEADERS,
    )

    assert named["name"] == "The spec"
    assert refused.status_code == 422, refused.text
    assert refused.json()["error"]["message"].startswith("url:")


# --------------------------------------------------------------------------- rename and delete


def test_rename_changes_the_display_name_only(api: TestClient, card: dict[str, Any]) -> None:
    item = upload_item(api, card["id"], filename="photo.png")

    response = api.patch(
        f"/api/attachments/{item['id']}", json={"name": "Mock-up"}, headers=CSRF_HEADERS
    )

    assert response.status_code == 200, response.text
    renamed = response.json()["item"]
    assert renamed["name"] == "Mock-up"
    assert renamed["url"] == item["url"]  # the file on disk keeps its own name
    assert stored(item["id"]).joinpath("photo.png").is_file()
    assert "attachment.renamed" in feed_types(api, card)


def test_renaming_to_the_same_name_records_nothing(api: TestClient, card: dict[str, Any]) -> None:
    item = upload_item(api, card["id"], filename="photo.png")

    response = api.patch(
        f"/api/attachments/{item['id']}", json={"name": "photo.png"}, headers=CSRF_HEADERS
    )

    assert response.status_code == 200, response.text
    assert "attachment.renamed" not in feed_types(api, card)


def test_deleting_the_cover_attachment_clears_the_cover_and_the_files(
    api: TestClient, card: dict[str, Any]
) -> None:
    item = upload_item(api, card["id"], filename="photo.png")
    assert set_cover(api, card["id"], kind="attachment", value=item["id"]).status_code == 200

    renamed = api.patch(
        f"/api/attachments/{item['id']}", json={"name": "Cover"}, headers=CSRF_HEADERS
    ).json()["item"]
    assert renamed["is_cover"] is True

    response = api.delete(f"/api/attachments/{item['id']}", headers=CSRF_HEADERS)

    assert response.status_code == 204, response.text
    assert card_body(api, card["id"])["cover"] is None
    assert not stored(item["id"]).exists()
    types = feed_types(api, card)
    assert "attachment.deleted" in types and "card.cover_removed" in types


def test_deleting_a_link_leaves_the_cover_alone(api: TestClient, card: dict[str, Any]) -> None:
    upload_item(api, card["id"], filename="photo.png")
    assert set_cover(api, card["id"], kind="color", value="green").status_code == 200
    link = link_item(api, card["id"], "https://example.com/")

    assert api.delete(f"/api/attachments/{link['id']}", headers=CSRF_HEADERS).status_code == 204
    assert card_body(api, card["id"])["cover"]["value"] == "green"


# --------------------------------------------------------------------------- covers


def test_a_colour_cover_and_an_attachment_cover_both_work(
    api: TestClient, card: dict[str, Any]
) -> None:
    item = upload_item(api, card["id"], filename="photo.png")

    colored = set_cover(api, card["id"], kind="color", value="green", size="full")
    assert colored.status_code == 200, colored.text
    assert colored.json()["item"]["cover"] == {"kind": "color", "value": "green", "size": "full"}

    attached = set_cover(api, card["id"], kind="attachment", value=item["id"])
    assert attached.status_code == 200, attached.text
    cover = attached.json()["item"]["cover"]
    assert cover["kind"] == "attachment"
    assert cover["value"] == str(item["id"])
    assert cover["size"] == "normal"
    assert "card.cover_changed" in feed_types(api, card)


def test_clear_cover_is_idempotent(api: TestClient, card: dict[str, Any]) -> None:
    assert set_cover(api, card["id"], kind="color", value="blue").status_code == 200

    first = api.delete(f"/api/cards/{card['id']}/cover", headers=CSRF_HEADERS)
    second = api.delete(f"/api/cards/{card['id']}/cover", headers=CSRF_HEADERS)

    assert first.status_code == 200 and first.json()["item"]["cover"] is None
    assert second.status_code == 200 and second.json()["item"]["cover"] is None
    assert feed_types(api, card).count("card.cover_removed") == 1


def test_a_cover_must_be_a_palette_key_or_a_thumbnailed_attachment_of_this_card(
    api: TestClient, board: dict[str, Any], card: dict[str, Any]
) -> None:
    other = create_card(api, list_ids(board["id"])[1], "Another card")["item"]
    elsewhere = upload_item(api, other["id"], filename="photo.png")
    link = link_item(api, card["id"], "https://example.com/")

    assert set_cover(api, card["id"], kind="color", value="chartreuse").status_code == 400
    assert set_cover(api, card["id"], kind="attachment", value=elsewhere["id"]).status_code == 400
    assert set_cover(api, card["id"], kind="attachment", value=link["id"]).status_code == 400
    assert set_cover(api, card["id"], kind="attachment", value="green").status_code == 400
    assert card_body(api, card["id"])["cover"] is None


# --------------------------------------------------------------------------- GET /uploads/{path}


def test_an_image_is_served_inline_and_a_document_as_a_download(
    api: TestClient, card: dict[str, Any]
) -> None:
    image = upload_item(api, card["id"], filename="photo.png")
    document = upload_item(api, card["id"], filename="brief.pdf", content=PDF_BYTES)

    served = api.get(image["url"])
    thumb = api.get(image["thumb_url"])
    downloaded = api.get(document["url"])

    assert served.status_code == 200, served.text
    assert served.content == png_bytes()
    assert served.headers["content-type"] == "image/png"
    assert served.headers["content-disposition"].startswith("inline")
    assert served.headers["x-content-type-options"] == "nosniff"
    assert served.headers["cache-control"] == "private, max-age=86400"
    assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/jpeg"
    assert downloaded.status_code == 200
    assert downloaded.headers["content-disposition"].startswith("attachment")


def test_a_traversal_path_is_400_and_a_missing_file_is_404(
    api: TestClient, card: dict[str, Any]
) -> None:
    item = upload_item(api, card["id"], filename="photo.png")

    escape = api.get("/uploads/attachments%2F..%2F..%2Fkanban.db")
    absolute = api.get("/uploads//etc/passwd")
    missing = api.get(f"/uploads/attachments/{item['id'] + 10_000}/photo.png")

    assert escape.status_code == 400, escape.text
    assert escape.json()["error"]["code"] == "bad_request"
    assert absolute.status_code == 400, absolute.text
    assert missing.status_code == 404, missing.text
    assert missing.json()["error"]["code"] == "not_found"


def test_a_deleted_attachment_stops_serving_its_file(api: TestClient, card: dict[str, Any]) -> None:
    """Section 4.11: the row is what makes the file servable, so a path with none is a 404."""
    item = upload_item(api, card["id"], filename="photo.png")
    assert api.get(item["url"]).status_code == 200

    assert api.delete(f"/api/attachments/{item['id']}", headers=CSRF_HEADERS).status_code == 204

    refused = api.get(item["url"])
    assert refused.status_code == 404
    assert refused.json()["error"]["code"] == "not_found"


# ------------------------------------------------------- the three cascades of Section 3.7


def test_deleting_a_card_removes_its_attachment_directories(
    api: TestClient, card: dict[str, Any]
) -> None:
    """Section 3.7: a hard delete takes the files with it, after the transaction commits."""
    uploaded = upload_item(api, card["id"], filename="photo.png")
    link_item(api, card["id"], "https://example.com/")
    assert stored(uploaded["id"]).is_dir()

    api.post(f"/api/cards/{card['id']}/archive", headers=CSRF_HEADERS)
    assert api.delete(f"/api/cards/{card['id']}", headers=CSRF_HEADERS).status_code == 204

    assert not stored(uploaded["id"]).exists()


def test_a_refused_delete_keeps_the_files(api: TestClient, card: dict[str, Any]) -> None:
    """The 409 of an unarchived card is not a delete, so nothing on disk may move."""
    uploaded = upload_item(api, card["id"], filename="photo.png")

    assert api.delete(f"/api/cards/{card['id']}", headers=CSRF_HEADERS).status_code == 409

    assert stored(uploaded["id"]).is_dir()


def test_deleting_an_archived_list_removes_the_files_of_its_cards(
    api: TestClient, board: dict[str, Any]
) -> None:
    """The list cascade reaches the attachments of every card it deletes (Section 3.7)."""
    list_id = list_ids(board["id"])[0]
    card_id = create_card(api, list_id, "Design home page")["item"]["id"]
    uploaded = upload_item(api, card_id, filename="photo.png")

    api.post(f"/api/lists/{list_id}/archive", headers=CSRF_HEADERS)
    assert api.delete(f"/api/lists/{list_id}", headers=CSRF_HEADERS).status_code == 204

    assert not stored(uploaded["id"]).exists()


def test_deleting_a_closed_board_removes_every_attachment_directory_below_it(
    api: TestClient, board: dict[str, Any]
) -> None:
    """The board cascade of Section 3.7, across two lists of the same board."""
    first, second = list_ids(board["id"])[:2]
    one = upload_item(api, create_card(api, first, "One")["item"]["id"], filename="one.png")
    two = upload_item(api, create_card(api, second, "Two")["item"]["id"], filename="two.png")

    api.post(f"/api/boards/{board['id']}/close", headers=CSRF_HEADERS)
    assert api.delete(f"/api/boards/{board['id']}", headers=CSRF_HEADERS).status_code == 204

    assert not stored(one["id"]).exists()
    assert not stored(two["id"]).exists()


def test_deleting_a_copied_card_keeps_the_original_files(
    api: TestClient, card: dict[str, Any], board: dict[str, Any]
) -> None:
    """A deep copy owns its own directory (Section 3.11), so the cascade must not reach back."""
    source = upload_item(api, card["id"], filename="photo.png")

    response = api.post(
        f"/api/cards/{card['id']}/copy",
        json={
            "title": "Design home page copy",
            "to_list_id": list_ids(board["id"])[0],
            "index": 1,
            "keep": {"attachments": True},
        },
        headers=CSRF_HEADERS,
    )
    assert response.status_code == 201, response.text
    copy_id = response.json()["item"]["id"]
    copied = api.get(f"/api/cards/{copy_id}").json()["attachments"]
    assert [row["id"] for row in copied] != [source["id"]]
    assert stored(copied[0]["id"]).is_dir()

    api.post(f"/api/cards/{copy_id}/archive", headers=CSRF_HEADERS)
    assert api.delete(f"/api/cards/{copy_id}", headers=CSRF_HEADERS).status_code == 204

    assert not stored(copied[0]["id"]).exists()
    assert stored(source["id"]).is_dir()
