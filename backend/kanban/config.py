"""Application settings.

Every command runs from the repo root, but the backend never depends on the current working
directory (Sections 1.8 and 6.12): `REPO_ROOT` is derived from this file's location and every
relative `KANBAN_*` path is resolved against it, so `python -m kanban`, `uvicorn --app-dir backend`
and `pytest backend` all see the same absolute paths.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: backend/kanban/config.py -> backend/kanban -> backend -> the repository root.
REPO_ROOT: Path = Path(__file__).resolve().parents[2]


def _absolute(path: Path) -> Path:
    """Resolve a configured path against REPO_ROOT, never against the cwd."""
    return path.resolve() if path.is_absolute() else (REPO_ROOT / path).resolve()


class Settings(BaseSettings):
    """The `KANBAN_*` environment (Section 1.9), read once at import time."""

    model_config = SettingsConfigDict(
        env_prefix="KANBAN_",
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: Literal["dev", "prod"] = "prod"
    host: str = "127.0.0.1"
    port: int = 8000
    data_dir: Path = Path("./data")
    db_path: Path | None = None
    frontend_dist: Path = Path("./frontend/dist")
    log_level: str = "info"
    log_format: Literal["text", "json"] = "text"
    sql_echo: bool = False

    @model_validator(mode="after")
    def _resolve_paths(self) -> "Settings":
        self.data_dir = _absolute(self.data_dir)
        self.db_path = _absolute(self.db_path) if self.db_path else self.data_dir / "kanban.db"
        self.frontend_dist = _absolute(self.frontend_dist)
        return self

    @property
    def is_dev(self) -> bool:
        return self.env == "dev"

    @property
    def db_url(self) -> str:
        """The only place the SQLAlchemy URL is built (engine and Alembic both read it)."""
        return f"sqlite:///{self.db_path}"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def backups_dir(self) -> Path:
        return self.data_dir / "backups"

    @property
    def resolved_log_level(self) -> str:
        """`KANBAN_ENV=dev` defaults the level to debug, unless it was set explicitly."""
        if self.is_dev and "log_level" not in self.model_fields_set:
            return "DEBUG"
        return self.log_level.upper()

    def ensure_directories(self) -> None:
        """Create the runtime tree (Section 3.11). Idempotent; safe to call on every start."""
        for directory in (
            self.data_dir,
            self.uploads_dir,
            self.uploads_dir / "backgrounds",
            self.uploads_dir / "tmp",
        ):
            directory.mkdir(parents=True, exist_ok=True)


#: Instantiated once; `db.py` and the lifespan read this module-level object directly.
settings = Settings()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """FastAPI dependency; tests override it to point at a temporary data directory."""
    return settings
