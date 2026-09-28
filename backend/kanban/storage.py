"""Upload file handling: the only module that touches `data/uploads/` (Sections 3.11 and 6.9).

The write order of Section 6.9 is split between this module and `services/attachments.py`
precisely so that no byte of network traffic and no Pillow call ever happens with the write lock
held:

1. `save_upload()` copies Starlette's already-spooled multipart body into `uploads/tmp/{uuid4}`
   in 1 MiB chunks, hashing `sha256` and counting bytes. No transaction is open.
2. `prepare_upload()` sniffs the type from the *content* (never the client's header) and, for the
   four image types, writes the 512x256 (2:1) cover thumbnail beside it as `tmp/{uuid4}.thumb.jpg`
   and computes `width`, `height` and `dominant_color`. Still no transaction; the caller runs it
   in a threadpool.
3. `place_upload()` is the only step inside the short `write_tx`: it `mkdir`s
   `attachments/{id}/` and `os.replace`s the temp files into it, which is a rename because
   `tmp/` is a sibling directory on the same filesystem.

`discard_upload()` and `delete_upload()` are the two undo paths (a rolled-back transaction and a
deleted row). `resolve_upload_path()` is the single place a client-supplied path becomes a real
one, and it refuses anything that escapes `data/uploads/`.

A board background (`POST /api/boards/{board_id}/background`) walks the same three steps through
`prepare_background()` and `place_background()`, sharing `save_upload`, `sniff_mime` and
`thumbnail` with the attachment path rather than repeating any of them. It differs in exactly the
two ways Section 6.9's right-hand column names: the sniffed type must be one of
`BACKGROUND_EXTENSIONS`, so anything else is a 415 instead of a stored file, and the id names the
file itself (`backgrounds/{id}.{ext}`) rather than a directory.
"""

import hashlib
import os
import shutil
import unicodedata
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.datastructures import UploadFile

from kanban.config import settings
from kanban.errors import BadRequest, TooLarge, UnsupportedMediaType

#: How much of the received spool is held in memory at a time (Section 6.9).
CHUNK_BYTES: Final[int] = 1024 * 1024

#: The 2:1 centre crop a card cover is painted from, and its JPEG quality (Sections 2.5 and 6.9).
THUMB_SIZE: Final[tuple[int, int]] = (512, 256)
THUMB_QUALITY: Final[int] = 85

#: The preview a board background gets, for the Home tile and the picker (Sections 3.11 and 6.9).
BACKGROUND_THUMB_SIZE: Final[tuple[int, int]] = (400, 240)

#: The thumbnail's name inside `attachments/{id}/`; also the last segment of `thumb_path`.
THUMB_NAME: Final[str] = "thumb.jpg"

#: The suffix of a background's thumbnail: `backgrounds/{id}.thumb.jpg` (Section 3.11).
BACKGROUND_THUMB_SUFFIX: Final[str] = ".thumb.jpg"

#: `attachments/{id}/...`, `backgrounds/{id}.{ext}` and `tmp/...` relative to
#: `settings.uploads_dir`; each is also the URL suffix after `/uploads/` (Section 3.11).
ATTACHMENTS_DIR: Final[str] = "attachments"
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

#: Section 3.11's `safe_name`: characters outside this set become `_`, and the result is cut to
#: 120 characters. It is deliberately the URL-safe subset, so `url` needs no further escaping.
SAFE_CHARACTERS: Final[frozenset[str]] = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
)
SAFE_NAME_MAX: Final[int] = 120

#: What a name made entirely of separators or dots falls back to, so a stored segment is never
#: `.` or `..` however the client spells the filename.
FALLBACK_NAME: Final[str] = "file"

#: Section 4.1's limit for an attachment `name`: the display name is the client's own filename,
#: which `schemas/attachments.py` also holds the rename to.
DISPLAY_NAME_MAX: Final[int] = 512

#: Names Windows resolves to a device rather than a file; prefixed with `_` (Section 6.9).
WINDOWS_RESERVED: Final[frozenset[str]] = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{digit}" for digit in range(1, 10)}
    | {f"LPT{digit}" for digit in range(1, 10)}
)

#: The four types that set `is_image=1`, get a thumbnail and are served inline (Section 6.9).
IMAGE_MIME_TYPES: Final[frozenset[str]] = frozenset(
    {"image/png", "image/jpeg", "image/gif", "image/webp"}
)

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

#: How many colours the dominant-colour pass quantises to, and the square it samples first.
DOMINANT_COLORS: Final[int] = 8
DOMINANT_SAMPLE: Final[int] = 64


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
    dominant_color: str


@dataclass(frozen=True)
class PreparedUpload:
    """Everything the `attachments` row needs, with both temp files still in `uploads/tmp/`."""

    display_name: str
    safe_name: str
    mime_type: str
    size_bytes: int
    sha256: str
    tmp_path: Path
    image: PreparedImage | None

    @property
    def is_image(self) -> bool:
        """Whether this upload sets `is_image=1` and carries a thumbnail (Section 6.9)."""
        return self.image is not None


@dataclass(frozen=True)
class PreparedBackground:
    """Everything a `board_backgrounds` row needs, with both temp files still in `uploads/tmp/`.

    Its own type rather than a `PreparedUpload`: a background has no display name, no `safe_name`
    (the id names the file) and no dominant colour, and its thumbnail is never optional - an image
    Pillow cannot crop is a 415 rather than a row stored without a preview (Section 6.9).
    """

    mime_type: str
    extension: str
    size_bytes: int
    width: int
    height: int
    tmp_path: Path
    thumb_tmp_path: Path


@dataclass(frozen=True)
class StoredPaths:
    """The `file_path` / `thumb_path` columns after the rename; both are also URL suffixes."""

    file_path: str
    thumb_path: str | None


@dataclass(frozen=True)
class StoredBackground:
    """The two `board_backgrounds` path columns after the rename; neither is ever null."""

    file_path: str
    thumb_path: str


def max_upload_bytes() -> int:
    """`KANBAN_MAX_UPLOAD_MB` in bytes: the cap `save_upload` enforces a second time.

    `BodySizeLimitMiddleware` is the boundary that refuses an oversized body before it is read
    (Section 6.9); this is the same number, so the belt-and-braces check inside the route can
    never disagree with it.
    """
    return settings.max_upload_mb * 1024 * 1024


def safe_name(filename: str | None) -> str:
    """The on-disk name of Section 3.11: NFC, `[^A-Za-z0-9._-]` -> `_`, 120 characters, no device.

    Every path separator is dropped with the directory part, so a client-supplied
    `../../etc/passwd` becomes the single segment `passwd`, and a segment that would still read as
    `.` or `..` falls back to `file`: this function is what makes `attachments/{id}/{safe_name}`
    a name rather than a path.
    """
    raw = unicodedata.normalize("NFC", (filename or "").strip())
    tail = raw.replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = "".join(character if character in SAFE_CHARACTERS else "_" for character in tail)
    if not cleaned.strip("."):
        cleaned = FALLBACK_NAME
    stem = cleaned.split(".", 1)[0]
    if stem.upper() in WINDOWS_RESERVED:
        cleaned = f"_{cleaned}"
    return cleaned[:SAFE_NAME_MAX]


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


def dominant_color(image: Image.Image) -> str:
    """The `#RRGGBB` a cover's letterboxing is painted with (Sections 2.5.1 and 6.9).

    A median-cut quantisation of a 64x64 sample, then the most populous bucket: the average
    colour of a photo with one bright subject on a dark ground is a muddy grey, while its
    dominant colour is the ground, which is what the tile needs behind a `contain` image.
    """
    sample = _flattened(image).resize((DOMINANT_SAMPLE, DOMINANT_SAMPLE))
    quantized = sample.quantize(colors=DOMINANT_COLORS, method=Image.Quantize.MEDIANCUT)
    palette = quantized.getpalette() or []
    counts = quantized.getcolors() or []
    index = max(counts)[1] if counts else 0
    red, green, blue = palette[index * 3 : index * 3 + 3] or (0, 0, 0)
    return f"#{red:02X}{green:02X}{blue:02X}"


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


def thumbnail(
    source: Path, destination: Path, *, size: tuple[int, int] = THUMB_SIZE
) -> PreparedImage | None:
    """Write the centre-crop JPEG of `source` to `destination` (Section 6.9).

    Returns the thumbnail's path with the *original* image's `width` / `height` and its dominant
    colour, or `None` when Pillow cannot open the file or its format is not one of the four
    Section 6.9 image types - a `.png` that is really a ZIP therefore gets no thumbnail, because
    the format is read from the content. `size` is the 512x256 card cover by default and the
    400x240 `BACKGROUND_THUMB_SIZE` for a board background; the crop rule is the same one.
    """
    try:
        with Image.open(source) as image:
            if PILLOW_FORMATS.get(image.format or "") is None:
                return None
            width, height = image.size
            color = dominant_color(image)
            fitted = ImageOps.fit(_flattened(image), size, method=Image.Resampling.LANCZOS)
            fitted.save(destination, format="JPEG", quality=THUMB_QUALITY)
    except (UnidentifiedImageError, OSError, ValueError):
        destination.unlink(missing_ok=True)
        return None
    return PreparedImage(tmp_path=destination, width=width, height=height, dominant_color=color)


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


def prepare_upload(received: ReceivedUpload, *, filename: str | None) -> PreparedUpload:
    """Sniff the type and build the thumbnail of a received file (Section 6.9 step 3).

    Synchronous and Pillow-bound, so the route runs it in a threadpool; nothing here opens a
    transaction. An image whose thumbnail cannot be produced keeps its sniffed type but is stored
    as a plain file, because `is_image` is exactly "has a thumbnail the cover can use".
    """
    mime_type = sniff_mime(received.tmp_path)
    image = (
        thumbnail(received.tmp_path, Path(f"{received.tmp_path}.thumb.jpg"))
        if mime_type in IMAGE_MIME_TYPES
        else None
    )
    return PreparedUpload(
        display_name=(filename or "").strip()[:DISPLAY_NAME_MAX] or FALLBACK_NAME,
        safe_name=safe_name(filename),
        mime_type=mime_type,
        size_bytes=received.size_bytes,
        sha256=received.sha256,
        tmp_path=received.tmp_path,
        image=image,
    )


def place_upload(attachment_id: int, prepared: PreparedUpload) -> StoredPaths:
    """Rename the temp files into `attachments/{attachment_id}/` (Section 6.9 step 5).

    The only filesystem work inside `write_tx`, and the reason the row is inserted first: the
    directory is named after the id SQLite assigns in the open transaction. `os.replace` is a
    rename within one filesystem, so the write lock is held for microseconds here.
    """
    directory = settings.uploads_dir / ATTACHMENTS_DIR / str(attachment_id)
    directory.mkdir(parents=True, exist_ok=True)
    os.replace(prepared.tmp_path, directory / prepared.safe_name)
    thumb_path: str | None = None
    if prepared.image is not None:
        os.replace(prepared.image.tmp_path, directory / THUMB_NAME)
        thumb_path = f"{ATTACHMENTS_DIR}/{attachment_id}/{THUMB_NAME}"
    return StoredPaths(
        file_path=f"{ATTACHMENTS_DIR}/{attachment_id}/{prepared.safe_name}",
        thumb_path=thumb_path,
    )


def discard_upload(prepared: PreparedUpload) -> None:
    """Delete whatever of an upload is still in `uploads/tmp/` (Section 6.9, "any failure").

    Safe after `place_upload` has run: the renames leave nothing behind, so this is a no-op on
    the success path and the whole cleanup on the rollback path.
    """
    prepared.tmp_path.unlink(missing_ok=True)
    if prepared.image is not None:
        prepared.image.tmp_path.unlink(missing_ok=True)


def delete_upload(attachment_id: int) -> None:
    """Remove `attachments/{attachment_id}/` with its file and thumbnail (Sections 3.7 and 6.9).

    Called after the delete has committed, never inside the transaction: a file cannot be
    un-deleted by a rollback, so the row goes first and the bytes follow. Missing files are not
    an error - `cleanup-orphans` exists precisely because a crash can leave either side behind.
    """
    shutil.rmtree(settings.uploads_dir / ATTACHMENTS_DIR / str(attachment_id), ignore_errors=True)


def delete_uploads(attachment_ids: Iterable[int]) -> None:
    """Remove the directory of every id in `attachment_ids` (Sections 3.7 and 3.11).

    The cascade half of `delete_upload`: deleting a card, an archived list or a closed board
    orphans every file under it, and Section 3.7 removes them all after that one commit. The
    three services hand in the ids `services/boards.orphaned_upload_ids()` read for them, so the
    loop - and with it "a file is unlinked after the transaction, never inside it" - is written
    once rather than three times.
    """
    for attachment_id in attachment_ids:
        delete_upload(attachment_id)


def prepare_background(received: ReceivedUpload) -> PreparedBackground:
    """Sniff a received board background and build its 400x240 preview (Section 6.9 step 3).

    The three steps `prepare_upload` takes for an attachment, with the one rule a background adds:
    the sniffed type must be PNG, JPEG or WebP, so anything else - including a `.png` that is
    really a ZIP, since `sniff_mime` reads the bytes - raises `UnsupportedMediaType` (415) and
    takes the temp file with it. Synchronous and Pillow-bound, so the route runs it in a
    threadpool; nothing here opens a transaction.
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
            "unsupported_media_type", "A board background must be a PNG, JPEG or WebP image."
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

    The background half of `place_upload`, and the only filesystem work inside `write_tx` for the
    same reason: the files are named after the id SQLite assigns in the open transaction.
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

    A no-op once `place_background` has renamed both files, and the whole cleanup otherwise -
    the same success/rollback pair as `discard_upload`.
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
