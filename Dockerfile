# Kan Ban - one image, two stages.
#
# Stage 1 builds the SPA with Node; stage 2 runs it with Python. Node is a build-time
# dependency only, exactly as docs/PLANNING.md Section 1.6 requires: no Node process
# exists at runtime and node_modules never reaches the final image.
#
#   docker build -t kanban .
#   docker run --rm -p 8000:8000 -v "$(pwd)/data:/app/data" kanban

# ---------------------------------------------------------------- stage 1: frontend
FROM node:20-slim AS web

WORKDIR /build

# Install dependencies from the lockfile alone, so a source edit does not bust this layer.
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm ci

COPY frontend ./frontend
RUN cd frontend && npm run build          # -> /build/frontend/dist

# ----------------------------------------------------------------- stage 2: runtime
FROM python:3.12-slim AS runtime

# PYTHONUNBUFFERED keeps log lines in order when Docker captures stdout.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    KANBAN_ENV=prod \
    KANBAN_HOST=0.0.0.0 \
    KANBAN_PORT=8000 \
    KANBAN_DATA_DIR=/app/data \
    KANBAN_FRONTEND_DIST=/app/frontend/dist

WORKDIR /app

# Install the backend from its own metadata first, for the same layer-caching reason.
COPY backend/pyproject.toml ./backend/
COPY backend/kanban/__init__.py ./backend/kanban/
RUN pip install --no-cache-dir ./backend

COPY backend ./backend
COPY --from=web /build/frontend/dist ./frontend/dist

# Run as a non-root user that owns the data volume.
RUN useradd --create-home --uid 10001 kanban \
    && mkdir -p /app/data \
    && chown -R kanban:kanban /app
USER kanban

VOLUME ["/app/data"]
EXPOSE 8000

# The app applies its own migrations at startup (Section 1.8), so there is no entrypoint script.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"

CMD ["python", "-m", "kanban"]
