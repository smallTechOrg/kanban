"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

Migration ids are NNNN_slug and strictly increasing (Section 3.9). Any migration that batch-
rebuilds an AUTOINCREMENT table must pass table_args={"sqlite_autoincrement": True}, and any
migration that batch-rebuilds `cards` must re-create the three cards_fts triggers and run
INSERT INTO cards_fts(cards_fts) VALUES ('rebuild').
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = ${repr(up_revision)}
down_revision: str | None = ${repr(down_revision)}
branch_labels: str | Sequence[str] | None = ${repr(branch_labels)}
depends_on: str | Sequence[str] | None = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
