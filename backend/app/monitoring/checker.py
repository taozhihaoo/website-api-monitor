"""HTTP(S) check execution.

The checker performs the network work for one check and produces a CheckOutcome;
it never touches the database (persistence happens in the engine). An
``httpx.MockTransport`` can be injected for fully offline tests.
"""

import socket
import ssl
import time
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urljoin, urlsplit

import httpx

from app.config import get_settings
from app.models.check import (
    ERROR_TYPE_CONNECTION,
    ERROR_TYPE_DNS,
    ERROR_TYPE_JSON,
    ERROR_TYPE_JSON_PARSE,
    ERROR_TYPE_KEYWORD,
    ERROR_TYPE_RESPONSE_TOO_LARGE,
    ERROR_TYPE_STATUS_MISMATCH,
    ERROR_TYPE_TIMEOUT,
    ERROR_TYPE_TLS,
)
from app.models.monitor import (
    MONITOR_TYPE_API_JSON,
    MONITOR_TYPE_KEYWORD,
    MONITOR_TYPE_SSL,
    RESULT_FAIL,
    SSL_STATUS_EXPIRED,
    SSL_STATUS_EXPIRING_SOON,
    SSL_STATUS_NOT_APPLICABLE,
    SSL_STATUS_UNKNOWN,
    SSL_STATUS_VALID,
    Monitor,
)
from app.monitoring.rules import evaluate_json, evaluate_keyword
from app.monitoring.ssl_checker import SSLChecker, SSLCheckError
from app.monitoring.url_guard import UrlValidationError, validate_public_http_url

MAX_REDIRECTS = 5
_MAX_ERROR_MESSAGE = 500


def classify_ssl_status(
    days_remaining: int | None, warning_days: int
) -> str:
    if days_remaining is None:
        return SSL_STATUS_UNKNOWN
    if days_remaining < 0:
        return SSL_STATUS_EXPIRED
    if days_remaining <= warning_days:
        return SSL_STATUS_EXPIRING_SOON
    return SSL_STATUS_VALID


@dataclass
class CheckOutcome:
    status: str
    http_status: int | None = None
    latency_ms: int | None = None
    error_type: str | None = None
    error_message: str | None = None
    keyword_result: str | None = None
    json_result: str | None = None
    ssl_status: str = SSL_STATUS_NOT_APPLICABLE
    ssl_days_remaining: int | None = None
    ssl_expires_at: datetime | None = None


class _ResponseTooLarge(Exception):
    pass


def _classify_connect_error(exc: BaseException) -> str:
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, ssl.SSLError):
            return ERROR_TYPE_TLS
        if isinstance(current, socket.gaierror):
            return ERROR_TYPE_DNS
        current = current.__cause__ or current.__context__
    return ERROR_TYPE_CONNECTION


def _down(outcome: CheckOutcome, error_type: str, message: str) -> CheckOutcome:
    outcome.status = "down"
    outcome.error_type = error_type
    outcome.error_message = message[:_MAX_ERROR_MESSAGE]
    return outcome


class HTTPChecker:
    """Executes checks for http / keyword / api_json / ssl monitor types."""

    def __init__(
        self,
        settings=None,
        transport: httpx.BaseTransport | None = None,
        sleep_fn=time.sleep,
        ssl_checker: SSLChecker | None = None,
    ):
        self.settings = settings or get_settings()
        self._transport = transport
        self._sleep = sleep_fn
        self._ssl_checker = ssl_checker or SSLChecker()

    # -- public API ---------------------------------------------------------

    def check(self, monitor: Monitor) -> CheckOutcome:
        if monitor.type == MONITOR_TYPE_SSL:
            return self._check_ssl_only(monitor)
        return self._check_http(monitor)

    # -- ssl-only monitors ----------------------------------------------------

    def _check_ssl_only(self, monitor: Monitor) -> CheckOutcome:
        outcome = CheckOutcome(status="up")
        started = time.perf_counter()
        parts = urlsplit(monitor.target_url)
        try:
            info = self._ssl_checker.fetch_certificate(
                parts.hostname, parts.port or 443, timeout=monitor.timeout_seconds
            )
        except SSLCheckError as exc:
            latency = int((time.perf_counter() - started) * 1000)
            outcome.latency_ms = latency
            outcome.ssl_status = SSL_STATUS_UNKNOWN
            if exc.reason == "timeout":
                return _down(outcome, ERROR_TYPE_TIMEOUT, str(exc))
            return _down(outcome, ERROR_TYPE_TLS, str(exc))

        outcome.latency_ms = int((time.perf_counter() - started) * 1000)
        outcome.ssl_days_remaining = info.days_remaining
        outcome.ssl_expires_at = info.expires_at
        outcome.ssl_status = classify_ssl_status(info.days_remaining, monitor.ssl_warning_days)
        if info.days_remaining < 0:
            return _down(
                outcome,
                "ssl_expired",
                f"SSL certificate expired {abs(info.days_remaining)} day(s) ago",
            )
        return outcome

    # -- http-based monitors --------------------------------------------------

    def _check_http(self, monitor: Monitor) -> CheckOutcome:
        outcome = CheckOutcome(status="up")
        started = time.perf_counter()

        try:
            response, body = self._request_with_retries(monitor)
        except _ResponseTooLarge:
            outcome.latency_ms = int((time.perf_counter() - started) * 1000)
            return _down(
                outcome,
                ERROR_TYPE_RESPONSE_TOO_LARGE,
                f"Response exceeded the {self.settings.max_response_bytes} byte limit",
            )
        except httpx.TimeoutException as exc:
            outcome.latency_ms = int((time.perf_counter() - started) * 1000)
            return _down(outcome, ERROR_TYPE_TIMEOUT, f"Request timed out: {exc}")
        except httpx.TooManyRedirects:
            outcome.latency_ms = int((time.perf_counter() - started) * 1000)
            return _down(outcome, ERROR_TYPE_CONNECTION, "Too many redirects")
        except httpx.ConnectError as exc:
            outcome.latency_ms = int((time.perf_counter() - started) * 1000)
            return _down(outcome, _classify_connect_error(exc), str(exc) or "Connection failed")
        except httpx.TransportError as exc:
            outcome.latency_ms = int((time.perf_counter() - started) * 1000)
            return _down(outcome, ERROR_TYPE_CONNECTION, str(exc) or "Transport error")
        except UrlValidationError as exc:
            outcome.latency_ms = int((time.perf_counter() - started) * 1000)
            return _down(outcome, ERROR_TYPE_CONNECTION, str(exc.message))

        outcome.latency_ms = int((time.perf_counter() - started) * 1000)
        outcome.http_status = response.status_code

        if response.status_code != monitor.expected_status:
            outcome.status = "down"
            outcome.error_type = ERROR_TYPE_STATUS_MISMATCH
            outcome.error_message = (
                f"Expected HTTP {monitor.expected_status}, got {response.status_code}"
            )
            return outcome

        if monitor.keyword is not None or monitor.type == MONITOR_TYPE_KEYWORD:
            keyword = monitor.keyword or ""
            result, reason = evaluate_keyword(body, keyword, monitor.keyword_mode)
            outcome.keyword_result = result
            if result == RESULT_FAIL:
                outcome.status = "down"
                outcome.error_type = ERROR_TYPE_KEYWORD
                outcome.error_message = reason
                return outcome

        if monitor.type == MONITOR_TYPE_API_JSON:
            result, reason, _ = evaluate_json(
                body, monitor.json_path or "", monitor.json_expected_value
            )
            outcome.json_result = result
            if result == RESULT_FAIL:
                outcome.status = "down"
                outcome.error_type = (
                    ERROR_TYPE_JSON_PARSE
                    if reason and reason.startswith("response body is not valid JSON")
                    else ERROR_TYPE_JSON
                )
                outcome.error_message = reason
                return outcome

        self._attach_ssl_info(monitor, outcome)
        return outcome

    def _attach_ssl_info(self, monitor: Monitor, outcome: CheckOutcome) -> None:
        """Sidecar SSL info: never flips the monitor status on failure."""
        if not monitor.ssl_check_enabled or not monitor.target_url.lower().startswith(
            "https://"
        ):
            outcome.ssl_status = SSL_STATUS_NOT_APPLICABLE
            return
        parts = urlsplit(monitor.target_url)
        try:
            info = self._ssl_checker.fetch_certificate(
                parts.hostname, parts.port or 443, timeout=monitor.timeout_seconds
            )
        except SSLCheckError:
            outcome.ssl_status = SSL_STATUS_UNKNOWN
            return
        outcome.ssl_status = classify_ssl_status(info.days_remaining, monitor.ssl_warning_days)
        outcome.ssl_days_remaining = info.days_remaining
        outcome.ssl_expires_at = info.expires_at

    # -- request plumbing -------------------------------------------------------

    def _request_with_retries(self, monitor: Monitor):
        attempts = self.settings.check_max_retries + 1
        last_exc: BaseException | None = None
        for attempt in range(attempts):
            try:
                return self._request_with_guard(monitor)
            except (UrlValidationError, _ResponseTooLarge):
                raise  # guard violations and size caps are deterministic — no retry
            except httpx.TransportError as exc:
                last_exc = exc
            if attempt < attempts - 1:
                self._sleep(self.settings.check_retry_backoff_seconds * (2**attempt))
        assert last_exc is not None
        raise last_exc

    def _request_with_guard(self, monitor: Monitor) -> tuple[httpx.Response, bytes]:
        timeout = httpx.Timeout(monitor.timeout_seconds)
        headers = {
            "User-Agent": self.settings.user_agent,
            "Accept": "*/*",
        }
        url = monitor.target_url
        with httpx.Client(
            transport=self._transport,
            timeout=timeout,
            follow_redirects=False,
            headers=headers,
            trust_env=False,
        ) as client:
            for hop in range(MAX_REDIRECTS + 1):
                validate_public_http_url(url)  # SSRF guard at every hop
                with client.stream("GET", url) as response:
                    if response.is_redirect:
                        location = response.headers.get("location", "")
                        if not location:
                            raise httpx.TransportError("Redirect without Location header")
                        url = _resolve_redirect(url, location)
                        if hop == MAX_REDIRECTS:
                            raise httpx.TooManyRedirects(
                                f"More than {MAX_REDIRECTS} redirects"
                            )
                        continue
                    body = self._read_capped(response)
                    return response, body
        raise RuntimeError("unreachable")  # pragma: no cover

    def _read_capped(self, response: httpx.Response) -> bytes:
        cap = self.settings.max_response_bytes
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_bytes():
            total += len(chunk)
            if total > cap:
                raise _ResponseTooLarge()
            chunks.append(chunk)
        return b"".join(chunks)


def _resolve_redirect(current_url: str, location: str) -> str:
    return urljoin(current_url, location)
