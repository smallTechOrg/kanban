# ---------------------------------------------------------------------------
# Kan Ban -- Unix mirror of the root npm scripts (see package.json).
#
# package.json is the single source of truth for what each task does; this file
# repeats only the small set of targets Unix users expect from `make`, using the
# venv's own interpreter so nothing can land in the system Python.
#
# VENV_BIN defaults to .venv/bin (Linux/macOS) and falls back to .venv/Scripts
# (Windows, e.g. Git Bash with GNU make installed) when that layout is present.
# ---------------------------------------------------------------------------

VENV_BIN ?= $(if $(wildcard .venv/Scripts/python.exe),.venv/Scripts,.venv/bin)
PY := $(VENV_BIN)/python
NPM ?= npm

.DEFAULT_GOAL := help
.PHONY: help setup dev build start migrate seed backup lint format typecheck test test-py test-js gen-types clean

help: ## List the available targets
	grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

setup: ## Create .venv, install the backend (editable, with dev extras) and the frontend toolchain
	uv venv --python 3.12 .venv
	uv pip install --python .venv -e "backend[dev]"
	$(NPM) install --prefix frontend

dev: ## Run uvicorn (:8000, --reload) and Vite (:5173) together
	$(NPM) run dev

build: ## Build the SPA into frontend/dist
	$(NPM) run build --prefix frontend

start: ## Serve the API and the built SPA from one Python process
	$(PY) -m kanban

migrate: ## Apply Alembic migrations up to head
	$(PY) -m kanban migrate

seed: ## Create the "Welcome to Kan Ban" demo fixture
	$(PY) -m kanban seed --demo

backup: ## VACUUM INTO data/backups/ and zip data/uploads/
	$(PY) -m kanban backup

lint: ## ruff check + ruff format --check on backend, eslint on frontend
	$(PY) -m ruff check backend
	$(PY) -m ruff format --check backend
	$(NPM) run lint --prefix frontend

format: ## Rewrite Python with ruff format and TypeScript with prettier
	$(PY) -m ruff format backend
	$(NPM) run format --prefix frontend

typecheck: ## tsc --noEmit on the frontend
	$(NPM) run typecheck --prefix frontend

test: test-py test-js ## Run the backend and frontend test suites

test-py: ## Run the pytest suite
	$(PY) -m pytest backend/tests

test-js: ## Run the vitest suite
	$(NPM) run test --prefix frontend

gen-types: ## Regenerate frontend/src/api/types.ts from the running API
	npx openapi-typescript http://127.0.0.1:8000/api/openapi.json -o frontend/src/api/types.ts

clean: ## Remove build output and tooling caches (never touches data/)
	rm -rf frontend/dist backend/.pytest_cache .ruff_cache coverage playwright-report test-results
