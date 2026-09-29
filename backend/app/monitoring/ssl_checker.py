"""TLS certificate inspection for HTTPS targets.

Uses a plain TLS handshake (certificate intentionally *not* verified against
the trust store — an expired/self-signed certificate must still be readable so
we can report on it).
"""

import socket
import ssl
from dataclasses import dataclass
from datetime import UTC, datetime

from cryptography import x509


@dataclass
class SSLInfo:
    expires_at: datetime
    days_remaining: int
    subject: str | None = None


class SSLCheckError(Exception):
    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason  # "timeout" | "unreachable"


def _create_insecure_context() -> ssl.SSLContext:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context


def days_until(expires_at: datetime, now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    delta = expires_at - now
    return int(delta.total_seconds() // 86400)


class SSLChecker:
    def fetch_certificate(
        self, host: str, port: int = 443, timeout: float = 10.0
    ) -> SSLInfo:
        try:
            with socket.create_connection((host, port), timeout=timeout) as sock:
                sock.settimeout(timeout)
                with _create_insecure_context().wrap_socket(
                    sock, server_hostname=host
                ) as tls:
                    der = tls.getpeercert(binary_form=True)
        except TimeoutError as exc:
            raise SSLCheckError("timeout", f"TLS handshake to {host} timed out") from exc
        except (ConnectionError, socket.gaierror, OSError) as exc:
            raise SSLCheckError("unreachable", f"TLS connection to {host} failed") from exc

        if not der:
            raise SSLCheckError("unreachable", "Server sent no certificate")
        try:
            cert = x509.load_der_x509_certificate(der)
            expires_at = cert.not_valid_after_utc
        except (ValueError, TypeError, AttributeError) as exc:
            raise SSLCheckError("unreachable", "Could not parse certificate") from exc

        subject_rdns = cert.subject.rfc4514_string()
        return SSLInfo(
            expires_at=expires_at,
            days_remaining=days_until(expires_at),
            subject=subject_rdns or None,
        )
