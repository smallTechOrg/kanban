"""Business rules: one module per aggregate, the only layer that writes (CLAUDE.md section 2).

A service knows nothing about HTTP: it takes `(db, user, ...)`, opens exactly one `write_tx()`
per mutation, records its activity rows through `activity.record()` and raises `ApiError`
subclasses from `errors.py`. Routers import services; services never import routers.
"""
