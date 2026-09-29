from datetime import timedelta

from app.models.base import utcnow
from app.models.check import MonitorCheck
from app.services.retention_service import delete_old_checks


class TestRetention:
    def test_deletes_only_old_checks(self, db_session):
        from tests.factories import make_monitor
        from tests.utils import create_user

        user = create_user(db_session)
        monitor = make_monitor(user_id=user.id, id=None)
        db_session.add(monitor)
        db_session.commit()

        db_session.add(
            MonitorCheck(
                monitor_id=monitor.id,
                status="up",
                checked_at=utcnow() - timedelta(days=40),
            )
        )
        db_session.add(
            MonitorCheck(
                monitor_id=monitor.id,
                status="up",
                checked_at=utcnow() - timedelta(days=10),
            )
        )
        db_session.commit()

        deleted = delete_old_checks(db_session, retention_days=30)
        assert deleted == 1
        remaining = db_session.query(MonitorCheck).all()
        assert len(remaining) == 1
        assert remaining[0].checked_at > utcnow() - timedelta(days=30)

    def test_zero_retention_disables_pruning(self, db_session):
        from tests.factories import make_monitor
        from tests.utils import create_user

        user = create_user(db_session)
        monitor = make_monitor(user_id=user.id, id=None)
        db_session.add(monitor)
        db_session.commit()
        db_session.add(
            MonitorCheck(
                monitor_id=monitor.id, status="up", checked_at=utcnow() - timedelta(days=400)
            )
        )
        db_session.commit()
        assert delete_old_checks(db_session, retention_days=0) == 0
        assert db_session.query(MonitorCheck).count() == 1
