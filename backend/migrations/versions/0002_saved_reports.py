"""Retain explicitly saved structured reports, without extracted page text."""

import sqlalchemy as sa
from alembic import op

revision = "0002_saved_reports"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("analyses", sa.Column("report", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("analyses", "report")
