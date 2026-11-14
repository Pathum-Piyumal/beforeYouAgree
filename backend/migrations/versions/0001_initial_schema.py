"""Create the initial relational schema.

Revision ID: 0001_initial_schema
Revises:
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def uuid_type() -> postgresql.UUID:
    return postgresql.UUID(as_uuid=True)


def timestamp_type() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("created_at", timestamp_type(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", timestamp_type(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=False)

    op.create_table(
        "analyses",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("user_id", uuid_type(), nullable=True),
        sa.Column("domain", sa.String(length=255), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("risk_band", sa.String(length=20), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("score_version", sa.String(length=20), nullable=True),
        sa.Column("created_at", timestamp_type(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", timestamp_type(), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "score IS NULL OR score BETWEEN 0 AND 100", name="ck_analyses_score_range"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_analyses_user_created_at", "analyses", ["user_id", "created_at"])

    op.create_table(
        "findings",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("analysis_id", uuid_type(), nullable=False),
        sa.Column("category", sa.String(length=30), nullable=False),
        sa.Column("risk_type", sa.String(length=80), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False),
        sa.Column("consequence", sa.Text(), nullable=False),
        sa.Column("evidence_excerpt", sa.Text(), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("source_locator", sa.String(length=255), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("created_at", timestamp_type(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", timestamp_type(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["analysis_id"], ["analyses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_findings_analysis_id", "findings", ["analysis_id"])

    op.create_table(
        "commitments",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("analysis_id", uuid_type(), nullable=False),
        sa.Column("finding_id", uuid_type(), nullable=True),
        sa.Column("kind", sa.String(length=50), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=True),
        sa.Column("date", timestamp_type(), nullable=True),
        sa.Column("relative_rule", sa.Text(), nullable=True),
        sa.Column("timezone", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="upcoming", nullable=False),
        sa.Column("created_at", timestamp_type(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", timestamp_type(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["analysis_id"], ["analyses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["finding_id"], ["findings.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_commitments_analysis_id", "commitments", ["analysis_id"])

    op.create_table(
        "reminders",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("user_id", uuid_type(), nullable=False),
        sa.Column("commitment_id", uuid_type(), nullable=False),
        sa.Column("remind_at", timestamp_type(), nullable=False),
        sa.Column("channel", sa.String(length=20), server_default="in_app", nullable=False),
        sa.Column("status", sa.String(length=20), server_default="scheduled", nullable=False),
        sa.Column("sent_at", timestamp_type(), nullable=True),
        sa.Column("created_at", timestamp_type(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", timestamp_type(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["commitment_id"], ["commitments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reminders_user_remind_at", "reminders", ["user_id", "remind_at"])

    op.create_table(
        "refresh_sessions",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("user_id", uuid_type(), nullable=False),
        sa.Column("token_hash", sa.String(length=255), nullable=False),
        sa.Column("expires_at", timestamp_type(), nullable=False),
        sa.Column("revoked_at", timestamp_type(), nullable=True),
        sa.Column("created_at", timestamp_type(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", timestamp_type(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )


def downgrade() -> None:
    op.drop_table("refresh_sessions")
    op.drop_index("ix_reminders_user_remind_at", table_name="reminders")
    op.drop_table("reminders")
    op.drop_index("ix_commitments_analysis_id", table_name="commitments")
    op.drop_table("commitments")
    op.drop_index("ix_findings_analysis_id", table_name="findings")
    op.drop_table("findings")
    op.drop_index("ix_analyses_user_created_at", table_name="analyses")
    op.drop_table("analyses")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
