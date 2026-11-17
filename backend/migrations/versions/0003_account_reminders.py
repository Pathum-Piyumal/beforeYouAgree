"""Confirmed account reminder times and idempotent create requests."""

import sqlalchemy as sa
from alembic import op

revision = "0003_account_reminders"
down_revision = "0002_saved_reports"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("reminders", sa.Column("event_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "reminders", sa.Column("timezone", sa.String(80), nullable=False, server_default="UTC")
    )
    op.add_column(
        "reminders",
        sa.Column("event_description", sa.String(280), nullable=False, server_default=""),
    )
    op.add_column("reminders", sa.Column("idempotency_key", sa.String(80), nullable=True))
    op.create_unique_constraint(
        "uq_reminders_user_request", "reminders", ["user_id", "idempotency_key"]
    )


def downgrade():
    op.drop_constraint("uq_reminders_user_request", "reminders", type_="unique")
    for name in ["idempotency_key", "event_description", "timezone", "event_at"]:
        op.drop_column("reminders", name)
