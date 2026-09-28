#!/usr/bin/env sh
# Kan Ban -- start the API (:8000, --reload) and Vite (:5173) together.
# Thin wrapper over `npm run dev`; package.json owns the two commands.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

PY="$ROOT/.venv/bin/python"
[ -x "$PY" ] || PY="$ROOT/.venv/Scripts/python.exe"
if [ ! -x "$PY" ]; then
  echo "error: no virtualenv at $ROOT/.venv -- run scripts/setup.sh first." >&2
  exit 1
fi

echo "==> API  http://127.0.0.1:8000  (interpreter: $PY)"
echo "==> Web  http://127.0.0.1:5173"
npm run dev
