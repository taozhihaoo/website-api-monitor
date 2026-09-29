"""Notification dispatch: webhook + email channels with alert deduplication.

Dedup rules (enforced by the engine, which only calls this service on
transitions — never on every check):

- ``monitor_down``  : exactly when an incident opens (UP → DOWN)
- ``recovered``     : exactly when that incident closes (DOWN → UP)
- ``ssl_expiring``  : when a certificate first enters its warning window
- ``ssl_expired``   : when a certificate lapses

Every dispatch attempt is recorded as a ``notifications`` row (sent / failed /
skipped) for auditing. Webhook targets go through the same SSRF guard as
monitors (private addresses allowed only via WEBHOOK_ALLOW_PRIVATE_IPS=true).
"""

import json
import logging
import smtplib
from email.message import EmailMessage

import httpx

from app.config import get_settings
from app.models.base import utcnow
from app.models.incident import Incident
from app.models.monitor import (
    SSL_ALERT_EXPIRED,
    SSL_ALERT_WARNING,
    Monitor,
)
from app.models.notification import (
    CHANNEL_EMAIL,
    CHANNEL_WEBHOOK,
    EVENT_MONITOR_DOWN,
    EVENT_RECOVERED,
    EVENT_SSL_EXPIRED,
    EVENT_SSL_EXPIRING,
    STATUS_FAILED,
    STATUS_SENT,
    STATUS_SKIPPED,
    Notification,
)
from app.models.user import User
from app.monitoring.url_guard import UrlValidationError, validate_webhook_url

logger = logging.getLogger("sitewatch.notifications")

EVENT_TEST = "test"


def compute_ssl_alert_state(days_remaining: int | None, warning_days: int) -> str | None:
    """None = no SSL data (no state machine involvement)."""
    if days_remaining is None:
        return None
    if days_remaining < 0:
        return SSL_ALERT_EXPIRED
    if days_remaining <= warning_days:
        return SSL_ALERT_WARNING
    return "ok"


class WebhookChannel:
    def __init__(
        self, url: str, timeout: float = 10.0, transport: httpx.BaseTransport | None = None
    ):
        self.url = url
        self.timeout = timeout
        self._transport = transport

    def send(self, payload: dict) -> tuple[str, str | None]:
        try:
            with httpx.Client(
                transport=self._transport, timeout=self.timeout, trust_env=False
            ) as client:
                response = client.post(self.url, json=payload)
        except httpx.HTTPError as exc:
            return STATUS_FAILED, str(exc)[:300]
        if 200 <= response.status_code < 300:
            return STATUS_SENT, None
        return STATUS_FAILED, f"webhook endpoint returned HTTP {response.status_code}"


class EmailChannel:
    def __init__(self, settings=None):
        self.settings = settings or get_settings()

    @property
    def enabled(self) -> bool:
        return self.settings.smtp_enabled

    def send(self, subject: str, body: str) -> tuple[str, str | None]:
        if not self.enabled:
            return STATUS_SKIPPED, "email notifications are not configured"
        message = EmailMessage()
        message["From"] = self.settings.smtp_from
        message["To"] = self.settings.smtp_to
        message["Subject"] = subject
        message.set_content(body)
        try:
            with smtplib.SMTP(
                self.settings.smtp_host, self.settings.smtp_port, timeout=15
            ) as smtp:
                if self.settings.smtp_use_tls:
                    smtp.starttls()
                if self.settings.smtp_username and self.settings.smtp_password:
                    smtp.login(self.settings.smtp_username, self.settings.smtp_password)
                smtp.send_message(message)
        except (smtplib.SMTPException, OSError) as exc:
            return STATUS_FAILED, str(exc)[:300]
        return STATUS_SENT, None


def build_payload(
    event: str, monitor: Monitor, incident: Incident | None = None
) -> dict:
    payload = {
        "event": event,
        "monitor": {
            "id": monitor.id,
            "name": monitor.name,
            "url": monitor.target_url,
            "type": monitor.type,
        },
        "status": {
            EVENT_MONITOR_DOWN: "down",
            EVENT_RECOVERED: "up",
        }.get(event, "ssl"),
        "timestamp": utcnow().isoformat(),
    }
    if incident is not None:
        payload["incident"] = {
            "id": incident.id,
            "started_at": incident.started_at.isoformat() if incident.started_at else None,
            "cause": incident.cause,
        }
        if incident.resolved_at is not None:
            payload["incident"]["resolved_at"] = incident.resolved_at.isoformat()
            payload["incident"]["duration_seconds"] = incident.duration_seconds
        payload["incident"]["failure_count"] = incident.failure_count
    if event in (EVENT_SSL_EXPIRING, EVENT_SSL_EXPIRED):
        payload["ssl"] = {
            "expires_at": (
                monitor.ssl_expires_at.isoformat() if monitor.ssl_expires_at else None
            ),
            "days_remaining": monitor.ssl_days_remaining,
        }
    return payload


class NotificationService:
    def __init__(
        self,
        settings=None,
        webhook_transport: httpx.BaseTransport | None = None,
        email_channel: EmailChannel | None = None,
    ):
        self.settings = settings or get_settings()
        self._webhook_transport = webhook_transport
        self._email_channel = email_channel

    # -- public transition hooks -------------------------------------------------

    def on_incident_opened(self, db, user: User, monitor: Monitor, incident: Incident) -> None:
        self._dispatch(db, user, monitor, incident, EVENT_MONITOR_DOWN)

    def on_incident_resolved(self, db, user: User, monitor: Monitor, incident: Incident) -> None:
        self._dispatch(db, user, monitor, incident, EVENT_RECOVERED)

    def on_ssl_state_change(
        self, db, user: User, monitor: Monitor, new_state: str
    ) -> None:
        if new_state == SSL_ALERT_WARNING:
            event = EVENT_SSL_EXPIRING
        elif new_state == SSL_ALERT_EXPIRED:
            event = EVENT_SSL_EXPIRED
        else:
            return  # entering/explicitly staying "ok" never notifies
        self._dispatch(db, user, monitor, None, event)

    def send_test(self, db, user: User) -> tuple[str, str | None]:
        """Send a test webhook; used by POST /api/me/notifications/test."""
        assert user.webhook_url
        payload = {
            "event": EVENT_TEST,
            "message": "SiteWatch test notification",
            "timestamp": utcnow().isoformat(),
        }
        return self._send_webhook(db, user, None, EVENT_TEST, payload)

    # -- plumbing -----------------------------------------------------------------

    def _dispatch(
        self,
        db,
        user: User,
        monitor: Monitor,
        incident: Incident | None,
        event: str,
    ) -> None:
        payload = build_payload(event, monitor, incident)

        if user.webhook_url:
            status_, detail = self._send_webhook(db, user, monitor, event, payload)
            db.add(
                Notification(
                    user_id=user.id,
                    monitor_id=monitor.id,
                    incident_id=incident.id if incident is not None else None,
                    channel=CHANNEL_WEBHOOK,
                    event=event,
                    status=status_,
                    detail=detail,
                )
            )

        email = self._email_channel or EmailChannel(self.settings)
        if email.enabled:
            status_, detail = email.send(
                f"[SiteWatch] {event}: {monitor.name}",
                json.dumps(payload, indent=2),
            )
            db.add(
                Notification(
                    user_id=user.id,
                    monitor_id=monitor.id,
                    incident_id=incident.id if incident is not None else None,
                    channel=CHANNEL_EMAIL,
                    event=event,
                    status=status_,
                    detail=detail,
                )
            )

    def _send_webhook(
        self,
        db,
        user: User,
        monitor: Monitor | None,
        event: str,
        payload: dict | None = None,
    ) -> tuple[str, str | None]:
        try:
            validate_webhook_url(
                user.webhook_url, allow_private=self.settings.webhook_allow_private_ips
            )
        except UrlValidationError as exc:
            return STATUS_FAILED, exc.message
        payload = payload or build_payload(event, monitor)
        channel = WebhookChannel(
            user.webhook_url,
            timeout=self.settings.webhook_timeout_seconds,
            transport=self._webhook_transport,
        )
        return channel.send(payload)
