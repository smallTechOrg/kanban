"""`python -m kanban <command>` and the `kanban` console script (Section 6.13).

`run` is the default subcommand, so a bare `python -m kanban` starts the server. Exactly one
uvicorn worker: the in-memory `BoardBus` and the single SQLite writer both assume it, and there
is deliberately no `--workers` flag.
"""

import argparse
import shutil
import sys
import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

import uvicorn
from sqlalchemy import select
from sqlalchemy.orm import Session

from kanban import __version__, seed
from kanban.config import settings
from kanban.db import SessionLocal, engine, upgrade_to_head
from kanban.logging_conf import configure_logging
from kanban.models import BoardBackground
from kanban.static import require_frontend_build

#: Every subcommand name, used to recognise a bare invocation as `run`.
COMMANDS = ("run", "migrate", "seed", "backup", "cleanup-orphans")

#: `tmp/` holds in-flight uploads; anything older than this was left by a crash (Section 3.11).
_TMP_MAX_AGE_SECONDS = 3600


def main(argv: Sequence[str] | None = None) -> int:
    """Entry point for both `python -m kanban` and the console script."""
    args = _build_parser().parse_args(_with_default_command(argv))
    configure_logging(settings)
    handler = args.handler
    return int(handler(args))


def _with_default_command(argv: Sequence[str] | None) -> list[str]:
    """Insert the default `run` subcommand so `kanban --port 9000` still works."""
    arguments = list(sys.argv[1:] if argv is None else argv)
    if arguments and (arguments[0] in COMMANDS or arguments[0] in ("-h", "--help", "--version")):
        return arguments
    return ["run", *arguments]


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="kanban", description="My Day server and maintenance.")
    parser.add_argument("--version", action="version", version=f"kanban {__version__}")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run = subparsers.add_parser("run", help="start the server (the default)")
    run.add_argument("--host", default=None, help=f"bind address (default {settings.host})")
    run.add_argument("--port", type=int, default=None, help=f"bind port (default {settings.port})")
    run.set_defaults(handler=_run)

    migrate = subparsers.add_parser("migrate", help="apply migrations without starting the server")
    migrate.set_defaults(handler=_migrate)

    seed = subparsers.add_parser("seed", help="create one of the demo fixtures")
    seed.add_argument("--demo", action="store_true", help="the four example boards")
    seed.add_argument("--big", action="store_true", help="30 lists x 100 cards for perf checks")
    seed.set_defaults(handler=_seed)

    backup = subparsers.add_parser("backup", help="VACUUM INTO a dated copy and zip the uploads")
    backup.add_argument("--out", default=None, help=f"target directory ({settings.backups_dir})")
    backup.set_defaults(handler=_backup)

    orphans = subparsers.add_parser("cleanup-orphans", help="remove upload files with no row")
    orphans.add_argument("--dry-run", action="store_true", help="list without deleting")
    orphans.set_defaults(handler=_cleanup_orphans)

    return parser


def _run(args: argparse.Namespace) -> int:
    """Start uvicorn with exactly one worker."""
    require_frontend_build(settings)
    host = args.host or settings.host
    port = args.port or settings.port
    print(f"My Day {__version__} listening on http://{host}:{port}")
    uvicorn.run(
        "kanban.main:app",
        host=host,
        port=port,
        workers=1,
        proxy_headers=True,
        log_config=None,  # `configure_logging` already owns the handlers (Section 6.11)
    )
    return 0


def _migrate(_args: argparse.Namespace) -> int:
    """Apply every pending migration, the same way the lifespan does."""
    settings.ensure_directories()
    upgrade_to_head()
    print(f"Database at {settings.db_path} is up to date.")
    return 0


def _backup(args: argparse.Namespace) -> int:
    """`VACUUM INTO data/backups/kanban-YYYYMMDD-HHMMSS.db`, then zip `data/uploads/`."""
    settings.ensure_directories()
    out_dir = Path(args.out).resolve() if args.out else settings.backups_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    target = out_dir / f"kanban-{stamp}.db"

    # VACUUM cannot run inside a transaction, so bypass the `begin` listener with AUTOCOMMIT.
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.exec_driver_sql("VACUUM INTO ?", (str(target),))
    print(f"Database backed up to {target}")

    if any(settings.uploads_dir.iterdir()):
        archive = shutil.make_archive(
            str(out_dir / f"kanban-{stamp}-uploads"), "zip", settings.uploads_dir
        )
        print(f"Uploads archived to {archive}")
    return 0


def _seed(args: argparse.Namespace) -> int:
    """Create the `--demo` or `--big` fixture; idempotent (Section 3.10)."""
    _prepare_database()
    with _session() as db:
        if args.big:
            if seed.seed_big(db):
                print(
                    f'Performance board "{seed.BIG_BOARD_NAME}" created: '
                    f"{seed.BIG_LIST_COUNT} lists of {seed.BIG_CARDS_PER_LIST} cards."
                )
            else:
                print(
                    f'Performance board "{seed.BIG_BOARD_NAME}" is already present; nothing to do.'
                )
        elif args.demo:
            created = seed.seed_demo(db)
            names = ", ".join(seed.DEMO_BOARD_NAMES)
            print(
                f"Example boards created: {created} of {len(seed.DEMO_BOARD_NAMES)} ({names})."
                if created
                else f"Example boards are already present ({names}); nothing to do."
            )
        else:
            print("Nothing to seed: pass --demo or --big.")
    return 0


def _cleanup_orphans(args: argparse.Namespace) -> int:
    """Reconcile `data/uploads/` with the rows that reference it (Sections 3.11 and 6.9).

    Deletes background images with no row, and `tmp/` leftovers older than an hour; lists rows
    whose file has gone missing.
    """
    settings.ensure_directories()
    uploads = settings.uploads_dir
    with _session() as db:
        background_ids = set(db.execute(select(BoardBackground.id)).scalars())
        missing = [
            path
            for path in db.execute(select(BoardBackground.file_path)).scalars()
            if not (uploads / path).is_file()
        ]

    orphans: list[Path] = [
        path
        for path in sorted((uploads / "backgrounds").iterdir())
        if path.is_file() and _row_id(path.name.split(".", 1)[0]) not in background_ids
    ]
    orphans += _stale_temp_files(uploads / "tmp")

    for path in orphans:
        print(f"{'orphan (kept)' if args.dry_run else 'removed'} {path}")
        if args.dry_run:
            continue
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink(missing_ok=True)
    for path in missing:
        # Listed, never deleted: Section 3.11 gives this command the files with no row, and a row
        # with no file is a restore-from-backup decision, not one a cleanup pass may take.
        print(f"dangling row: no file at {uploads / path}")
    print(f"{len(orphans)} orphaned path(s), {len(missing)} row(s) with a missing file.")
    return 0


def _prepare_database() -> None:
    """Every write subcommand needs the runtime tree and an up-to-date schema first."""
    settings.ensure_directories()
    upgrade_to_head()


@contextmanager
def _session() -> Iterator[Session]:
    """One Session shaped like the one `get_db` hands a request, closed on the way out."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.rollback()  # ends the deferred read snapshot the SELECTs above autobegan
        db.close()


def _row_id(name: str) -> int | None:
    """The row id an uploads path is named after, or None when it is not an id at all."""
    return int(name) if name.isdigit() else None


def _stale_temp_files(tmp_dir: Path) -> list[Path]:
    """In-flight upload spools left behind by a crash (`tmp/` files older than an hour)."""
    cutoff = time.time() - _TMP_MAX_AGE_SECONDS
    return [path for path in sorted(tmp_dir.iterdir()) if path.stat().st_mtime < cutoff]
