"""`python -m kanban` is the same entry point as the `kanban` console script."""

from kanban.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
