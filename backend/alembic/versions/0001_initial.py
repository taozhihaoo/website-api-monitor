"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-09-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("webhook_url", sa.String(length=2048), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    op.create_table(
        "monitors",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("target_url", sa.String(length=2048), nullable=False),
        sa.Column("interval_seconds", sa.Integer(), nullable=False),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False),
        sa.Column("expected_status", sa.Integer(), nullable=False),
        sa.Column("keyword", sa.String(length=500), nullable=True),
        sa.Column("keyword_mode", sa.String(length=20), nullable=False),
        sa.Column("json_path", sa.String(length=500), nullable=True),
        sa.Column("json_expected_value", sa.String(length=500), nullable=True),
        sa.Column("ssl_check_enabled", sa.Boolean(), nullable=False),
        sa.Column("ssl_warning_days", sa.Integer(), nullable=False),
        sa.Column("last_status", sa.String(length=10), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(), nullable=True),
        sa.Column("next_check_at", sa.DateTime(), nullable=True),
        sa.Column("ssl_expires_at", sa.DateTime(), nullable=True),
        sa.Column("ssl_days_remaining", sa.Integer(), nullable=True),
        sa.Column("ssl_last_checked_at", sa.DateTime(), nullable=True),
        sa.Column("ssl_alert_state", sa.String(length=20), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_monitors_user_id"), "monitors", ["user_id"], unique=False)
    op.create_index(op.f("ix_monitors_next_check_at"), "monitors", ["next_check_at"], unique=False)

    op.create_table(
        "monitor_checks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("monitor_id", sa.Integer(), nullable=False),
        sa.Column("checked_at", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("error_type", sa.String(length=40), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("keyword_result", sa.String(length=10), nullable=True),
        sa.Column("json_result", sa.String(length=10), nullable=True),
        sa.Column("ssl_days_remaining", sa.Integer(), nullable=True),
        sa.Column("ssl_status", sa.String(length=20), nullable=False),
        sa.ForeignKeyConstraint(["monitor_id"], ["monitors.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_monitor_checks_monitor_id"), "monitor_checks", ["monitor_id"], unique=False
    )
    op.create_index(
        op.f("ix_monitor_checks_checked_at"), "monitor_checks", ["checked_at"], unique=False
    )

    op.create_table(
        "incidents",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("monitor_id", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("failure_count", sa.Integer(), nullable=False),
        sa.Column("cause", sa.String(length=500), nullable=True),
        sa.Column("is_resolved", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["monitor_id"], ["monitors.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_incidents_monitor_id"), "incidents", ["monitor_id"], unique=False)
    op.create_index(op.f("ix_incidents_is_resolved"), "incidents", ["is_resolved"], unique=False)

    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("monitor_id", sa.Integer(), nullable=True),
        sa.Column("incident_id", sa.Integer(), nullable=True),
        sa.Column("channel", sa.String(length=20), nullable=False),
        sa.Column("event", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["monitor_id"], ["monitors.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_notifications_user_id"), "notifications", ["user_id"], unique=False
    )
    op.create_index(
        op.f("ix_notifications_monitor_id"), "notifications", ["monitor_id"], unique=False
    )


def downgrade() -> None:
    op.drop_table("notifications")
    op.drop_table("incidents")
    op.drop_table("monitor_checks")
    op.drop_table("monitors")
    op.drop_table("users")
