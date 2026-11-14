"""enforce at most one open incident per monitor

Revision ID: 0002_one_open_incident
Revises: 0001_initial
Create Date: 2026-11-12

The check engine serialises results per monitor in-process, but a database-level
constraint also protects against multiple backend processes (or a crash between
the SELECT and INSERT) creating two open incidents for one monitor — one of
which could never be closed by the recovery path.
"""
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa

from alembic import op

revision: str = "0002_one_open_incident"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    # Existing deployments may already contain duplicate open incidents.
    # Keep the newest one per monitor and close the stale ones before the
    # unique index is created (otherwise the migration would fail).
    #
    # Use an application-generated UTC instant (not CURRENT_TIMESTAMP, which
    # follows the DB session timezone) and fill in duration_seconds — otherwise
    # the repaired rows show "—" as duration forever.
    now = datetime.now(UTC).replace(tzinfo=None)
    if bind.dialect.name == "postgresql":
        duration = "GREATEST(0, EXTRACT(EPOCH FROM (:now - started_at))::int)"
    else:
        duration = "MAX(0, CAST((julianday(:now) - julianday(started_at)) * 86400 AS INTEGER))"
    bind.execute(
        sa.text(
            f"""
            UPDATE incidents
               SET is_resolved = TRUE,
                   resolved_at = :now,
                   duration_seconds = {duration}
             WHERE is_resolved = FALSE
               AND id NOT IN (
                   SELECT MAX(id)
                     FROM incidents
                    WHERE is_resolved = FALSE
                    GROUP BY monitor_id
               )
            """
        ),
        {"now": now},
    )
    op.create_index(
        "uq_incidents_one_open_per_monitor",
        "incidents",
        ["monitor_id"],
        unique=True,
        postgresql_where=sa.text("is_resolved = FALSE"),
        sqlite_where=sa.text("is_resolved = 0"),
    )


def downgrade() -> None:
    op.drop_index("uq_incidents_one_open_per_monitor", table_name="incidents")
