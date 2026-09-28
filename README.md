# Kan Ban

A self-hosted, Trello-inspired kanban board you run yourself. One Python process serves the JSON API under
`/api` and the compiled React single-page app; SQLite is the only datastore; Node is the build and dev
toolchain and never runs in production.

> Trello is a trademark of Atlassian. This project is not affiliated with, endorsed by, or sponsored by
> Atlassian. Trello is referenced here only as a UX reference point for the interface this app imitates.

- Specification and single source of truth: [docs/PLANNING.md](docs/PLANNING.md)
- Engineering rules every change must follow: [CLAUDE.md](CLAUDE.md)

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Python | 3.12 | The runtime server. Installed into a repo-local `.venv`. |
| Node.js + npm | 20 or newer | Build and dev toolchain only; not needed on a production machine once `frontend/dist` is built. |
| [uv](https://docs.astral.sh/uv/) | latest | Creates the venv and installs the backend. Used by `npm run setup`. |
| Git | any | Optional, for cloning. |

SQLite is bundled with Python; nothing to install. FTS5 (used by search) ships with the CPython build.

**Every command in this README runs from the repo root.** The backend never depends on the current working
directory: relative `KANBAN_*` paths resolve against the repo root, not the cwd.

---

## Quick start

### Windows (PowerShell)

```powershell
cd "E:\smalltech\kan ban"
Copy-Item .env.example .env      # optional; the defaults work as-is
.\scripts\setup.ps1              # creates .venv, installs backend[dev] and the frontend toolchain
npm run build                    # compiles the SPA into frontend\dist
npm start                        # http://127.0.0.1:8000
```

### Linux / macOS (bash)

```bash
cd "/path/to/kan ban"
cp .env.example .env             # optional; the defaults work as-is
./scripts/setup.sh               # or: make setup
npm run build                    # or: make build
npm start                        # or: make start  ->  http://127.0.0.1:8000
```

---

## Daily development loop

Development runs **two processes**: uvicorn on `:8000` (API, uploads, SSE) and Vite on `:5173` (the page,
with HMR, proxying `/api` and `/uploads` to :8000). In dev, open the app at **http://127.0.0.1:5173**.

```bash
npm run dev          # both processes via concurrently (Windows: .\scripts\dev.ps1, Unix: make dev)
```

Or in two terminals, if you prefer separate logs:

```bash
npm run dev:api      # uvicorn kanban.main:app --app-dir backend --reload --port 8000
npm run dev:web      # vite dev server on :5173
```

Set `KANBAN_ENV=dev` in `.env` for local work: it enables CORS for `:5173`, skips the `frontend/dist` check
and mounts the dev-login route.

Before calling anything done:

```bash
npm run lint && npm run typecheck && npm run test
```

After changing any Pydantic schema, regenerate the frontend's API types (with the API running):

```bash
npm run gen:types    # writes frontend/src/api/types.ts from /api/openapi.json
```

---

## Production build and run

```bash
npm run build        # vite build -> frontend/dist
npm start            # one Python process serves /api, /uploads and the SPA on :8000
```

At startup the server creates `data/` and `data/uploads/`, applies Alembic migrations, prunes expired
sessions and verifies that `frontend/dist/index.html` exists (it exits with code 2 and a clear message
otherwise, unless `KANBAN_ENV=dev`). `GET /api/health` is the reverse-proxy health check.

Set `KANBAN_HOST=0.0.0.0` to expose the server beyond loopback - do that only behind a reverse proxy, and
change `KANBAN_ADMIN_PASSWORD` first if `KANBAN_SINGLE_USER=1`.

---

## Running in Docker

```bash
cp .env.example .env     # optional: every setting has a working default
docker compose up --build
```

The image is built in two stages: `node:20-slim` compiles the interface, then `python:3.12-slim` runs it.
No Node process exists in the final image. The service listens on port 8000 and keeps the database,
uploads and backups in `./data` on the host, so the container itself stays disposable. Inside the
container `KANBAN_HOST` is `0.0.0.0`, because a loopback bind would not reach the published port; on the
host the default stays loopback-only.

To build and run without Compose:

```bash
docker build -t kanban .
docker run --rm -p 8000:8000 -v "$(pwd)/data:/app/data" kanban
```

---

## Further reading

| Document | What it covers |
|---|---|
| [docs/PLANNING.md](docs/PLANNING.md) | The full specification: screens, schema, API, architecture, milestones |
| [docs/API.md](docs/API.md) | Endpoint reference, generated from the running app's OpenAPI document |
| [docs/audit/CHECKLIST.md](docs/audit/CHECKLIST.md) | Interface fidelity audit, row by row, with its evidence |
| [CHANGELOG.md](CHANGELOG.md) | What shipped in each release, and the known gaps |
| [CLAUDE.md](CLAUDE.md) | Engineering rules: layering, single sources of truth, testing, deviations |

The running app also serves interactive API documentation at `/api/docs`.

---

## Task reference

`package.json` at the repo root is the single source of truth for what each task does. The `Makefile`
mirrors the same targets for Unix users, and `scripts/*.ps1` / `scripts/*.sh` are thin wrappers that resolve
the repo root from their own location, so they work from any directory.

> **Interpreter paths.** The npm scripts call the venv interpreter directly at `.venv/Scripts/python`, which
> is the **Windows** layout. On Linux and macOS the same interpreter lives at `.venv/bin/python` - use the
> `Makefile` there (`make dev`, `make test`, ...), which picks the right one automatically.

| npm | make | What it does |
|---|---|---|
| `npm run setup` | `make setup` | Create `.venv`, install `backend[dev]` into it, install the frontend toolchain |
| `npm run dev` | `make dev` | uvicorn `:8000` (`--reload`) and Vite `:5173` together |
| `npm run build` | `make build` | Build the SPA into `frontend/dist` |
| `npm start` | `make start` | Serve API + SPA from one Python process |
| `npm run migrate` | `make migrate` | Apply Alembic migrations to head |
| `npm run seed` | `make seed` | Create the "Welcome to Kan Ban" demo fixture |
| `npm run backup` | `make backup` | `VACUUM INTO data/backups/` plus a zip of `data/uploads/` |
| `npm run lint` | `make lint` | `ruff check` + `ruff format --check` on the backend, eslint on the frontend |
| `npm run format` | `make format` | Rewrite Python with `ruff format`, TypeScript with prettier |
| `npm run typecheck` | `make typecheck` | `tsc --noEmit` |
| `npm run test` | `make test` | pytest, then vitest |
| `npm run test:py` | `make test-py` | pytest only (`backend/tests`) |
| `npm run test:js` | `make test-js` | vitest only |
| `npm run gen:types` | `make gen-types` | Regenerate `frontend/src/api/types.ts` from the running API |

Playwright end-to-end specs land in M2; the CI job for them is present but skipped until then.

### Tests and lint

| Layer | Tool | Command |
|---|---|---|
| Backend units and API | pytest + httpx `TestClient` (+ hypothesis for ordering) | `npm run test:py` |
| Frontend units and components | vitest + Testing Library + msw | `npm run test:js` |
| Python lint and format | ruff (line length 100) | `npm run lint:py` |
| TypeScript lint and format | eslint + prettier | `npm run lint:js` |
| TypeScript types | `tsc --noEmit` | `npm run typecheck` |

CI (`.github/workflows/ci.yml`) runs the Python job and the web job on both `ubuntu-latest` and
`windows-latest` for every push and pull request.

---

## Environment variables

All settings are read by `backend/kanban/config.py` (pydantic-settings) from the environment or from a
`.env` file in the repo root. The prefix is `KANBAN_`. Copy [.env.example](.env.example) to `.env` to
override any of them; relative paths resolve against the repo root, never the cwd.

| Variable | Default | Purpose |
|---|---|---|
| `KANBAN_ENV` | `prod` | `dev` enables CORS for :5173, skips the dist-exists check, mounts `/api/auth/dev-login` and defaults the log level to `debug` |
| `KANBAN_HOST` | `127.0.0.1` | Bind address for uvicorn. Loopback by default because `KANBAN_SINGLE_USER=1` creates `admin` with a known default password; set `0.0.0.0` on a home server or VPS behind a reverse proxy |
| `KANBAN_PORT` | `8000` | Bind port |
| `KANBAN_DATA_DIR` | `./data` | Root for the database, uploads and backups (relative paths resolve against the repo root, never the cwd) |
| `KANBAN_DB_PATH` | `${KANBAN_DATA_DIR}/kanban.db` | SQLite file path |
| `KANBAN_SECRET` | auto-generated into `${KANBAN_DATA_DIR}/.secret` on first run | Key for itsdangerous session-cookie signing; changing it logs everyone out. An empty string counts as unset |
| `KANBAN_HTTPS` | `0` | `1` sets the `Secure` flag on `kb_session` (use behind TLS) |
| `KANBAN_SESSION_DAYS` | `30` | Sliding session TTL |
| `KANBAN_SINGLE_USER` | `0` | `1` creates user `admin` (email `admin@localhost`) on first start and prefills the login form |
| `KANBAN_ADMIN_PASSWORD` | `admin` | Password for the bootstrapped `admin` user (only read when `KANBAN_SINGLE_USER=1`) |
| `KANBAN_ALLOW_SIGNUP` | `1` | `0` returns 403 from `POST /api/auth/register` once at least one user exists |
| `KANBAN_LOGIN_RATE_LIMIT` | `10/300` | Attempts per seconds per IP on `POST /api/auth/login` and `/register` (in-memory token bucket) |
| `KANBAN_MAX_UPLOAD_MB` | `25` | Attachment upload size cap (413 above it); board background images are capped at 10 MB |
| `KANBAN_FRONTEND_DIST` | `./frontend/dist` | Where the built SPA lives (relative to the repo root); lets a packaged install point elsewhere |
| `KANBAN_LOG_LEVEL` | `info` | uvicorn/app log level |
| `KANBAN_LOG_FORMAT` | `text` | `text` or `json` (one JSON object per line for log shippers) |
| `KANBAN_SQL_ECHO` | `0` | `1` logs every SQL statement (`sqlalchemy.engine` at INFO) |

The frontend has no runtime environment variables: it always calls the same-origin `/api`.

---

## Project layout

```text
kan ban/
├── README.md                    this file
├── CLAUDE.md                    binding engineering rules
├── package.json                 root task runner (dev / build / start / test / gen:types)
├── Makefile                     Unix mirror of the npm scripts
├── .env.example                 every KANBAN_* variable with its default
├── .github/workflows/ci.yml     ruff + pytest, tsc + eslint + vitest + build (ubuntu and windows)
├── scripts/                     setup / dev / build wrappers, one .ps1 and one .sh each
├── docs/PLANNING.md             the specification
├── backend/                     Python package `kanban` + pytest suite + Alembic migrations
│   ├── pyproject.toml
│   ├── alembic/
│   ├── kanban/                  routers/ services/ schemas/ models.py db.py config.py ...
│   └── tests/
├── frontend/                    Vite + React + TypeScript SPA
│   └── src/                     api/ hooks/ lib/ store/ components/ pages/ styles/
├── e2e/                         Playwright specs (from M2)
└── data/                        runtime state, git-ignored: kanban.db, uploads/, backups/
```

Each directory is created by the milestone that first needs it; Section 1.7 of the plan has the full tree
and Section 7 the milestone order.

---

## Troubleshooting

**`database is locked` / HTTP 503 `database_busy`.**
SQLite allows one writer at a time. The server opens write transactions with `BEGIN IMMEDIATE` and a 5 s
`busy_timeout`, so a contended write waits rather than failing mid-transaction; past the timeout the API
answers `503` with `Retry-After: 1` and the client retries. If it happens persistently, something else is
holding the database open - close any SQLite browser, `sqlite3` shell or second `python -m kanban` process
pointed at the same `data/kanban.db`. Never put `data/` on a network share (SMB/NFS): file locking there is
unreliable and this error becomes permanent.

**`kanban.db-wal` and `kanban.db-shm` files.**
These are normal. WAL mode keeps a write-ahead log (`-wal`) and a shared-memory index (`-shm`) next to the
database while the server runs; they are checkpointed and removed on a clean shutdown. Never copy
`kanban.db` alone while the server is running - the `-wal` file holds committed data that is not in the main
file yet. Use `npm run backup` (`VACUUM INTO`) to take a consistent snapshot instead, or stop the server
first and copy all three files together. Deleting the sidecars while the server runs can corrupt the
database; deleting them after a clean shutdown is harmless.

**The repo path contains a space (`E:\smalltech\kan ban`).**
Quote every path in every command and script: `cd "E:\smalltech\kan ban"`, `python -m pytest "backend/tests"`.
The npm scripts deliberately use relative, space-free arguments (`--prefix frontend`, `--app-dir backend`) so
the space never reaches a child process unquoted. If a tool reports `cannot find E:\smalltech\kan`, an
unquoted path is the cause. The same rule applies to `make`, which does not handle spaces in absolute paths:
run it from the repo root so every path it sees stays relative.

**`Frontend build not found: run "npm run build" first` (exit code 2).**
`npm start` serves the compiled SPA and refuses to start without it. Run `npm run build` to create
`frontend/dist/index.html`, or set `KANBAN_ENV=dev` when you are running the Vite dev server on :5173 and do
not need the built assets. If the build lives elsewhere, point `KANBAN_FRONTEND_DIST` at it.

**A bare `python` is not the venv interpreter.**
The npm scripts call `.venv/Scripts/python` explicitly so a `python` on `PATH` can never be used by
accident. When running commands by hand, activate the venv first (`.venv\Scripts\Activate.ps1` on Windows,
`source .venv/bin/activate` elsewhere) or call the interpreter by its full path.

**`uv: command not found` during setup.**
`npm run setup` uses [uv](https://docs.astral.sh/uv/) to create the venv and install the backend. Install
uv, then re-run `npm run setup`.
