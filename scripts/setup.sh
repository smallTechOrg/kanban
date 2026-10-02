#!/usr/bin/env sh
# My Day -- one-time setup (Linux/macOS/Git Bash).
# Thin wrapper over `npm run setup`; package.json owns what setup actually does.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v uv >/dev/null 2>&1; then
  echo "error: 'uv' is required to create the virtualenv and install the backend." >&2
  echo "       Install it from https://docs.astral.sh/uv/ then re-run this script." >&2
  exit 1
fi

echo "==> Setting up My Day in $ROOT"
npm run setup
echo "==> Done. Next: '$ROOT/scripts/dev.sh' for the dev loop, or 'npm run build && npm start' for production."
