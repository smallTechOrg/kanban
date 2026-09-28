#!/usr/bin/env sh
# Kan Ban -- production build: compile the SPA into frontend/dist.
# Thin wrapper over `npm run build`; package.json owns the build command.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building the SPA into $ROOT/frontend/dist"
npm run build
echo "==> Done. Start the server with 'npm start' (or scripts/start equivalent: .venv/bin/python -m kanban)."
