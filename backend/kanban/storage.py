"""Upload file handling: the only module that touches `data/uploads/` (Sections 3.11 and 6.9).

A board background (`POST /api/boards/{board_id}/background`) is the one upload the app accepts,
and the write order of Section 6.9 is split between this module and `services/boards.py` precisely
so that no byte of network traffic and no Pillow call ever happens with the write lock held:

1. `save_upload()` copies Starlette's already-spooled multipart body into `uploads/tmp/{uuid4}`
   in 1 MiB chunks, hashing `sha256` and counting bytes. No transaction is open.
2. `prepare_background()` sniffs the type from the *content* (never the client's header) and
   writes the 400x240 preview beside it. Still no transaction; the caller runs it in a threadpool.
   The sniffed type must be one of `BACKGROUND_EXTENSIONS`, so anything else is a 415 rather than
   a stored file.
3. `place_background()` is the only step inside the short `write_tx`: it `os.replace`s the temp
   files onto `backgrounds/{id}.{ext}`, which is a rename because `tmp/` is a sibling directory on
   the same filesystem. The id names the file itself rather than a directory.

`discard_background()` and `delete_background()` are the two undo paths (a rolled-back transaction
and a deleted row). `resolve_upload_path()` is the single place a client-supplied path becomes a
real one, and it refuses anything that escapes `data/uploads/`.
"""

import hashlib
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.datastructures import UploadFile

from kanban.config import settings
from kanban.errors import BadRequest, TooLarge, UnsupportedMediaType

#: How much of the received spool is held in memory at a time (Section 6.9).
CHUNK_BYTES: Final[int] = 1024 * 1024

#: The preview a board background gets, for the Home tile and the picker (Sections 3.11 and 6.9),
#: and the JPEG quality it is written at.
BACKGROUND_THUMB_SIZE: Final[tuple[int, int]] = (400, 240)
THUMB_QUALITY: Final[int] = 85

#: The suffix of a background's thumbnail: `backgrounds/{id}.thumb.jpg` (Section 3.11).
BACKGROUND_THUMB_SUFFIX: Final[str] = ".thumb.jpg"

#: `backgrounds/{id}.{ext}` and `tmp/...` relative to `settings.uploads_dir`; each is also the
#: URL suffix after `/uploads/` (Section 3.11).
BACKGROUNDS_DIR: Final[str] = "backgrounds"
TMP_DIR: Final[str] = "tmp"

#: The three types a board background may be, and the extension each is stored under
#: (Section 6.9). The type is Pillow's, never the client's header, so this table is also the
#: whole 415 rule: a key that is missing is a refused upload.
BACKGROUND_EXTENSIONS: Final[dict[str, str]] = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
}

#: `Image.open().format` -> MIME, which is how an image's type is decided (Section 6.9).
PILLOW_FORMATS: Final[dict[str, str]] = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "GIF": "image/gif",
    "WEBP": "image/webp",
}

#: The "small magic-number table" of Section 3.11, for the types Pillow cannot open. Each entry
#: is (offset, signature, MIME); anything unrecognised is `application/octet-stream`, which is
#: served as a download anyway, so the table only has to be right, never complete.
MAGIC_NUMBERS: Final[tuple[tuple[int, bytes, str], ...]] = (
    (0, b"%PDF-", "application/pdf"),
    (0, b"PK\x03\x04", "application/zip"),
    (0, b"\x1f\x8b", "application/gzip"),
    (0, b"ID3", "audio/mpeg"),
    (0, b"OggS", "audio/ogg"),
    (0, b"\x89PNG", "image/png"),  # a PNG Pillow refused to open is still a PNG
    (0, b"%!PS", "application/postscript"),
    (4, b"ftyp", "video/mp4"),
)

#: How many bytes the magic table needs, and the default when none of it matches.
MAGIC_PREFIX_BYTES: Final[int] = 16
DEFAULT_MIME: Final[str] = "application/octet-stream"


@dataclass(frozen=True)
class ReceivedUpload:
    """A body that has reached `uploads/tmp/` intact, with nothing sniffed yet."""

    tmp_path: Path
    size_bytes: int
    sha256: str


@dataclass(frozen=True)
class PreparedImage:
    """The thumbnail and the image metadata of one received image (Section 6.9)."""

    tmp_path: Path
    width: int
    height: int


@dataclass(frozen=True)
class PreparedBackground:
    """Everything a `board_backgrounds` row needs, with both temp files still in `uploads/tmp/`.

    Its own type rather than a `PreparedImage`: a background carries the stored row's `mime_type`,
    `extension` and `size_bytes`, the id names the file so there is no display name, and its
    thumbnail is never optional - an image Pillow cannot crop is a 415 rather than a row stored
    without a preview (Section 6.9).
    """

    mime_type: str
    extension: str
    size_bytes: int
    width: int
    height: int
    tmp_path: Path
    thumb_tmp_path: Path


@dataclass(frozen=True)
class StoredBackground:
    """The two `board_backgrounds` path columns after the rename; neither is ever null."""

    file_path: str
    thumb_path: str


def _tmp_path() -> Path:
    """A fresh `uploads/tmp/{uuid4}`. The directory is created if the tree is new."""
    directory = settings.uploads_dir / TMP_DIR
    directory.mkdir(parents=True, exist_ok=True)
    return directory / uuid.uuid4().hex


async def save_upload(file: UploadFile, *, max_bytes: int) -> ReceivedUpload:
    """Copy one received multipart file into `uploads/tmp/`, hashing it (Section 6.9 step 2).

    Starlette has already spooled the whole body, so this copies a local file in `CHUNK_BYTES`
    pieces rather than reading from the socket; `BodySizeLimitMiddleware` is the real size
    boundary and this is the belt-and-braces one. Raises `TooLarge` (413 `payload_too_large`)
    when the spool is bigger than `max_bytes`, having removed the partial temp file.
    """
    destination = _tmp_path()
    digest = hashlib.sha256()
    size = 0
    try:
        with destination.open("wb") as sink:
            while chunk := await file.read(CHUNK_BYTES):
                size += len(chunk)
                if size > max_bytes:
                    raise TooLarge(
                        "payload_too_large",
                        f"Request body exceeds the {max_bytes / (1024 * 1024):.0f} MB limit.",
                    )
                digest.update(chunk)
                sink.write(chunk)
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return ReceivedUpload(tmp_path=destination, size_bytes=size, sha256=digest.hexdigest())


def _flattened(image: Image.Image) -> Image.Image:
    """The image as RGB, with any transparency composited onto white.

    A plain `convert("RGB")` turns transparent pixels black, which would make the thumbnail of
    every logo-on-nothing PNG a black box and its dominant colour `#000000`.
    """
    if image.mode == "RGB":
        return image
    rgba = image.convert("RGBA")
    background = Image.new("RGB", rgba.size, (255, 255, 255))
    background.paste(rgba, mask=rgba.getchannel("A"))
    return background


def thumbnail(source: Path, destination: Path, *, size: tuple[int, int]) -> PreparedImage | None:
    """Write the centre-crop JPEG of `source` to `destination` (Section 6.9).

    Returns the thumbnail's path with the *original* image's `width` / `height`, or `None` when
    Pillow cannot open the file or its format is not one of the four Section 6.9 image types - a
    `.png` that is really a ZIP therefore gets no thumbnail, because the format is read from the
    content. `size` is the 400x240 `BACKGROUND_THUMB_SIZE` of the one upload that remains.
    """
    try:
        with Image.open(source) as image:
            if PILLOW_FORMATS.get(image.format or "") is None:
                return None
            width, height = image.size
            fitted = ImageOps.fit(_flattened(image), size, method=Image.Resampling.LANCZOS)
            fitted.save(destination, format="JPEG", quality=THUMB_QUALITY)
    except (UnidentifiedImageError, OSError, ValueError):
        destination.unlink(missing_ok=True)
        return None
    return PreparedImage(tmp_path=destination, width=width, height=height)


def sniff_mime(path: Path) -> str:
    """The MIME type of a received file, read from its bytes and never from the client.

    Pillow answers for the image types (Section 6.9 makes `Image.open().format` the rule), the
    magic table of Section 3.11 for the handful of formats worth naming, and everything else is
    `application/octet-stream`, which `GET /uploads/{path}` sends as a download.
    """
    try:
        with Image.open(path) as image:
            pillow_mime = PILLOW_FORMATS.get(image.format or "")
    except (UnidentifiedImageError, OSError, ValueError):
        pillow_mime = None
    if pillow_mime is not None:
        return pillow_mime
    with path.open("rb") as handle:
        prefix = handle.read(MAGIC_PREFIX_BYTES)
    for offset, signature, mime in MAGIC_NUMBERS:
        if prefix[offset : offset + len(signature)] == signature:
            return mime
    return DEFAULT_MIME


def prepare_background(received: ReceivedUpload) -> PreparedBackground:
    """Sniff a received board background and build its 400x240 preview (Section 6.9 step 3).

    Sniff, crop, describe - with the one rule a background adds: the sniffed type must be PNG,
    JPEG or WebP, so anything else - including a `.png` that is really a ZIP, since `sniff_mime`
    reads the bytes - raises `UnsupportedMediaType` (415) and takes the temp file with it.
    Synchronous and Pillow-bound, so the route runs it in a threadpool; nothing here opens a
    transaction.
    """
    mime_type = sniff_mime(received.tmp_path)
    extension = BACKGROUND_EXTENSIONS.get(mime_type)
    thumb_destination = Path(f"{received.tmp_path}{BACKGROUND_THUMB_SUFFIX}")
    image = (
        None
        if extension is None
        else thumbnail(received.tmp_path, thumb_destination, size=BACKGROUND_THUMB_SIZE)
    )
    if extension is None or image is None:
        received.tmp_path.unlink(missing_ok=True)
        raise UnsupportedMediaType(
            "unsupported_media_type", "A space background must be a PNG, JPEG or WebP image."
        )
    return PreparedBackground(
        mime_type=mime_type,
        extension=extension,
        size_bytes=received.size_bytes,
        width=image.width,
        height=image.height,
        tmp_path=received.tmp_path,
        thumb_tmp_path=image.tmp_path,
    )


def place_background(background_id: int, prepared: PreparedBackground) -> StoredBackground:
    """Rename the temp files to `backgrounds/{id}.{ext}` and `.thumb.jpg` (Section 6.9 step 5).

    The only filesystem work inside `write_tx`, for one reason: the files are named after the id
    SQLite assigns in the open transaction.
    """
    directory = settings.uploads_dir / BACKGROUNDS_DIR
    directory.mkdir(parents=True, exist_ok=True)
    file_name = f"{background_id}.{prepared.extension}"
    thumb_name = f"{background_id}{BACKGROUND_THUMB_SUFFIX}"
    os.replace(prepared.tmp_path, directory / file_name)
    os.replace(prepared.thumb_tmp_path, directory / thumb_name)
    return StoredBackground(
        file_path=f"{BACKGROUNDS_DIR}/{file_name}",
        thumb_path=f"{BACKGROUNDS_DIR}/{thumb_name}",
    )


def discard_background(prepared: PreparedBackground) -> None:
    """Delete whatever of a background upload is still in `uploads/tmp/` (Section 6.9).

    A no-op once `place_background` has renamed both files, and the whole cleanup otherwise.
    """
    prepared.tmp_path.unlink(missing_ok=True)
    prepared.thumb_tmp_path.unlink(missing_ok=True)


def delete_background(background_id: int) -> None:
    """Remove `backgrounds/{id}.{ext}` and its thumbnail (Sections 3.7 and 6.9).

    Called when the transaction that inserted the row rolled back after the rename, so the files
    do not outlive it. Both names begin `{id}.`, and no other id shares that prefix, so one glob
    covers whichever extension the upload turned out to be. Missing files are not an error:
    `cleanup-orphans` exists precisely because a crash can leave either side behind.
    """
    directory = settings.uploads_dir / BACKGROUNDS_DIR
    for path in directory.glob(f"{background_id}.*"):
        path.unlink(missing_ok=True)


def resolve_upload_path(relative: str) -> Path:
    """The absolute path of `GET /uploads/{path}`, or `BadRequest` if it escapes the tree.

    `Path.resolve()` collapses `..` and follows links, and the result must be *inside*
    `data/uploads/`; an absolute or drive-qualified path, a traversal and the uploads directory
    itself are all refused with 400 `bad_request` (Sections 3.11 and 4.11). Existence is not
    checked here: a resolved-but-missing file is the caller's 404.
    """
    base = settings.uploads_dir.resolve()
    candidate = Path(base, relative).resolve()
    if base not in candidate.parents:
        raise BadRequest("bad_request", "That is not a valid upload path.")
    return candidate
