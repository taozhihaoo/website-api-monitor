import json

import httpx

from app.config import Settings
from app.models.notification import Notification
from app.monitoring.checker import CheckOutcome
from app.monitoring.engine import run_check
from app.notifications import NotificationService, compute_ssl_alert_state
from tests.factories import make_monitor
from tests.utils import create_user


def webhook_notifier(captured: list):
    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content))
        return httpx.Response(200)

    return NotificationService(webhook_transport=httpx.MockTransport(handler))


class FailingWebhookNotifier(NotificationService):
    pass


def failing_notifier(captured: list):
    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(500)

    return NotificationService(webhook_transport=httpx.MockTransport(handler))


def _monitor_with_webhook(db_session, url="https://hooks.example.com/alert", **kw):
    user = create_user(db_session)
    user.webhook_url = url
    monitor = make_monitor(user_id=user.id, id=None, **kw)
    db_session.add(monitor)
    db_session.commit()
    return user, monitor


class TestWebhookNotifications:
    def test_down_alert_sent_on_incident_open(self, db_session):
        captured: list = []
        notifier = webhook_notifier(captured)
        user, monitor = _monitor_with_webhook(db_session)

        run_check(
            db_session, monitor, _Fixed(CheckOutcome(status="down", error_message="boom")), notifier
        )

        assert len(captured) == 1
        payload = captured[0]
        assert payload["event"] == "monitor_down"
        assert payload["monitor"]["name"] == monitor.name
        assert payload["monitor"]["url"] == monitor.target_url
        assert payload["status"] == "down"
        assert payload["incident"]["cause"] == "boom"
        assert "timestamp" in payload
        row = db_session.query(Notification).filter_by(channel="webhook").one()
        assert row.status == "sent"

    def test_no_duplicate_alert_while_down(self, db_session):
        captured: list = []
        notifier = webhook_notifier(captured)
        user, monitor = _monitor_with_webhook(db_session)

        run_check(db_session, monitor, _Fixed(CheckOutcome(status="down")), notifier)
        run_check(db_session, monitor, _Fixed(CheckOutcome(status="down")), notifier)
        run_check(db_session, monitor, _Fixed(CheckOutcome(status="down")), notifier)

        assert len(captured) == 1  # dedup: only the initial down

    def test_recovery_alert_sent_once(self, db_session):
        captured: list = []
        notifier = webhook_notifier(captured)
        user, monitor = _monitor_with_webhook(db_session)

        run_check(db_session, monitor, _Fixed(CheckOutcome(status="down")), notifier)
        run_check(db_session, monitor, _Fixed(CheckOutcome(status="down")), notifier)
        run_check(db_session, monitor, _Fixed(CheckOutcome(status="up")), notifier)
        run_check(db_session, monitor, _Fixed(CheckOutcome(status="up")), notifier)

        events = [p["event"] for p in captured]
        assert events == ["monitor_down", "recovered"]
        recovery = captured[1]
        assert recovery["status"] == "up"
        assert recovery["incident"]["failure_count"] == 2

    def test_webhook_failure_recorded_but_check_unaffected(self, db_session):
        captured: list = []
        notifier = failing_notifier(captured)
        user, monitor = _monitor_with_webhook(db_session)

        row = run_check(
            db_session, monitor, _Fixed(CheckOutcome(status="down", error_message="x")), notifier
        )
        assert row.status == "down"  # delivery failure doesn't change the result
        row_ = (
            db_session.query(Notification).filter_by(channel="webhook").one()
        )
        assert row_.status == "failed"

    def test_webhook_private_address_rejected(self, db_session):
        captured: list = []
        notifier = webhook_notifier(captured)
        user, monitor = _monitor_with_webhook(db_session, url="http://127.0.0.1/hook")

        run_check(db_session, monitor, _Fixed(CheckOutcome(status="down")), notifier)
        assert captured == []  # never sent
        row = db_session.query(Notification).filter_by(channel="webhook").one()
        assert row.status == "failed"
        assert "not allowed" in row.detail

    def test_no_webhook_configured_no_attempts(self, db_session):
        user = create_user(db_session)
        monitor = make_monitor(user_id=user.id, id=None)
        db_session.add(monitor)
        db_session.commit()
        notifier = webhook_notifier([])
        run_check(db_session, monitor, _Fixed(CheckOutcome(status="down")), notifier)
        assert db_session.query(Notification).filter_by(channel="webhook").count() == 0


class TestEmailNotifications:
    def _email_settings(self):
        return Settings(
            smtp_host="smtp.example.com",
            smtp_port=587,
            smtp_username="user",
            smtp_password="pass",
            smtp_from="alerts@example.com",
            smtp_to="admin@example.com",
        )

    def test_email_sent_on_down(self, db_session, monkeypatch):
        sent = []

        class FakeSMTP:
            def __init__(self, host, port, timeout=None):
                sent.append(("connect", host, port))

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def starttls(self):
                sent.append(("starttls",))

            def login(self, u, p):
                sent.append(("login", u))

            def send_message(self, message):
                sent.append(("send", message["Subject"], message["To"]))

        monkeypatch.setattr("app.notifications.service.smtplib.SMTP", FakeSMTP)
        notifier = NotificationService(settings=self._email_settings())
        user, monitor = _monitor_with_webhook(db_session, url=None)

        run_check(db_session, monitor, _Fixed(CheckOutcome(status="down")), notifier)

        actions = [s[0] for s in sent]
        assert actions == ["connect", "starttls", "login", "send"]
        subject = sent[-1][1]
        assert "monitor_down" in subject and monitor.name in subject
        row = db_session.query(Notification).filter_by(channel="email").one()
        assert row.status == "sent"

    def test_email_disabled_by_default_no_rows(self, db_session):
        notifier = NotificationService(settings=Settings())
        user, monitor = _monitor_with_webhook(db_session, url=None)
        run_check(db_session, monitor, _Fixed(CheckOutcome(status="down")), notifier)
        assert db_session.query(Notification).filter_by(channel="email").count() == 0


class TestSslAlerts:
    def test_expiring_alert_sent_once(self, db_session):
        captured: list = []
        notifier = webhook_notifier(captured)
        user, monitor = _monitor_with_webhook(db_session, ssl_check_enabled=True)

        # first check inside warning window → ssl_expiring
        run_check(
            db_session,
            monitor,
            _Fixed(
                CheckOutcome(status="up", ssl_status="expiring_soon", ssl_days_remaining=17)
            ),
            notifier,
        )
        # further checks still inside window → no repeat
        run_check(
            db_session,
            monitor,
            _Fixed(
                CheckOutcome(status="up", ssl_status="expiring_soon", ssl_days_remaining=16)
            ),
            notifier,
        )

        events = [p["event"] for p in captured]
        assert events == ["ssl_expiring"]
        assert captured[0]["ssl"]["days_remaining"] == 17
        assert monitor.ssl_alert_state == "warning"

    def test_expired_alert_after_warning(self, db_session):
        captured: list = []
        notifier = webhook_notifier(captured)
        user, monitor = _monitor_with_webhook(db_session, ssl_check_enabled=True)

        run_check(
            db_session,
            monitor,
            _Fixed(CheckOutcome(status="up", ssl_status="expiring_soon", ssl_days_remaining=10)),
            notifier,
        )
        run_check(
            db_session,
            monitor,
            _Fixed(CheckOutcome(status="down", ssl_status="expired", ssl_days_remaining=-1)),
            notifier,
        )

        # the expired-cert check also flips the monitor down → incident alert as well
        events = [p["event"] for p in captured]
        assert events == ["ssl_expiring", "monitor_down", "ssl_expired"]
        assert monitor.ssl_alert_state == "expired"

    def test_no_ssl_alert_when_healthy(self, db_session):
        captured: list = []
        notifier = webhook_notifier(captured)
        user, monitor = _monitor_with_webhook(db_session, ssl_check_enabled=True)

        run_check(
            db_session,
            monitor,
            _Fixed(CheckOutcome(status="up", ssl_status="valid", ssl_days_remaining=90)),
            notifier,
        )
        assert captured == []
        assert monitor.ssl_alert_state == "ok"

    def test_rearm_after_renewal(self, db_session):
        captured: list = []
        notifier = webhook_notifier(captured)
        user, monitor = _monitor_with_webhook(db_session, ssl_check_enabled=True)

        run_check(
            db_session,
            monitor,
            _Fixed(CheckOutcome(status="up", ssl_status="expiring_soon", ssl_days_remaining=20)),
            notifier,
        )
        # certificate renewed
        run_check(
            db_session,
            monitor,
            _Fixed(CheckOutcome(status="up", ssl_status="valid", ssl_days_remaining=90)),
            notifier,
        )
        # expires again later
        run_check(
            db_session,
            monitor,
            _Fixed(CheckOutcome(status="up", ssl_status="expiring_soon", ssl_days_remaining=25)),
            notifier,
        )
        events = [p["event"] for p in captured]
        assert events == ["ssl_expiring", "ssl_expiring"]


class TestComputeSslAlertState:
    def test_states(self):
        assert compute_ssl_alert_state(None, 30) is None
        assert compute_ssl_alert_state(90, 30) == "ok"
        assert compute_ssl_alert_state(30, 30) == "warning"
        assert compute_ssl_alert_state(-1, 30) == "expired"


class TestSettingsEndpoints:
    def test_update_webhook(self, client):
        from tests.utils import register_and_login

        headers = register_and_login(client)
        resp = client.put(
            "/api/me/notifications",
            json={"webhook_url": "https://hooks.example.com/alert"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["webhook_url"] == "https://hooks.example.com/alert"
        me = client.get("/api/auth/me", headers=headers).json()
        assert me["webhook_url"].endswith("/alert")

    def test_update_webhook_private_rejected(self, client):
        from tests.utils import register_and_login

        headers = register_and_login(client)
        resp = client.put(
            "/api/me/notifications",
            json={"webhook_url": "http://localhost/hook"},
            headers=headers,
        )
        assert resp.status_code == 400

    def test_clear_webhook(self, client):
        from tests.utils import register_and_login

        headers = register_and_login(client)
        client.put(
            "/api/me/notifications",
            json={"webhook_url": "https://hooks.example.com/alert"},
            headers=headers,
        )
        resp = client.put("/api/me/notifications", json={"webhook_url": None}, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["webhook_url"] is None

    def test_test_notification(self, client, monkeypatch):
        from tests.utils import register_and_login

        captured: list = []

        def handler(request: httpx.Request) -> httpx.Response:
            captured.append(json.loads(request.content))
            return httpx.Response(200)

        original = NotificationService

        def factory(*args, **kwargs):
            return original(*args, webhook_transport=httpx.MockTransport(handler), **kwargs)

        monkeypatch.setattr("app.api.routes.settings.NotificationService", factory)

        headers = register_and_login(client)
        resp = client.post("/api/me/notifications/test", headers=headers)
        assert resp.status_code == 400  # not configured yet

        client.put(
            "/api/me/notifications",
            json={"webhook_url": "https://hooks.example.com/alert"},
            headers=headers,
        )
        resp = client.post("/api/me/notifications/test", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "sent"
        assert captured[0]["event"] == "test"


class _Fixed:
    def __init__(self, outcome):
        self.outcome = outcome

    def check(self, monitor):
        return self.outcome
