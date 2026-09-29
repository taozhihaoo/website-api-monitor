import socket
import ssl

import httpx
import pytest

from app.config import Settings
from app.monitoring.checker import HTTPChecker, classify_ssl_status
from app.monitoring.ssl_checker import SSLCheckError
from tests.factories import FakeSSLChecker, make_monitor


def make_checker(handler, **settings_overrides) -> HTTPChecker:
    settings = Settings(**settings_overrides)
    return HTTPChecker(
        settings=settings,
        transport=httpx.MockTransport(handler),
        sleep_fn=lambda seconds: None,
    )


class TestHttpStatus:
    def test_200_expected_200_is_up(self):
        checker = make_checker(lambda request: httpx.Response(200, text="ok"))
        outcome = checker.check(make_monitor())
        assert outcome.status == "up"
        assert outcome.http_status == 200
        assert outcome.latency_ms is not None
        assert outcome.latency_ms >= 0
        assert outcome.error_type is None

    def test_404_is_down_status_mismatch(self):
        checker = make_checker(lambda request: httpx.Response(404, text="nope"))
        outcome = checker.check(make_monitor())
        assert outcome.status == "down"
        assert outcome.error_type == "status_mismatch"
        assert "404" in outcome.error_message

    def test_5xx_is_down(self):
        checker = make_checker(lambda request: httpx.Response(503))
        outcome = checker.check(make_monitor())
        assert outcome.status == "down"
        assert outcome.error_type == "status_mismatch"

    def test_custom_expected_status(self):
        checker = make_checker(lambda request: httpx.Response(204))
        monitor = make_monitor(expected_status=204)
        assert checker.check(monitor).status == "up"

    def test_user_agent_is_sent(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["ua"] = request.headers.get("user-agent", "")
            return httpx.Response(200)

        checker = make_checker(handler)
        checker.check(make_monitor())
        assert seen["ua"].startswith("SiteWatch/")


class TestTransportErrors:
    def test_timeout(self):
        def handler(request):
            raise httpx.ReadTimeout("timed out")

        outcome = make_checker(handler).check(make_monitor())
        assert outcome.status == "down"
        assert outcome.error_type == "timeout"

    def test_connect_error(self):
        def handler(request):
            raise httpx.ConnectError("connection refused")

        outcome = make_checker(handler).check(make_monitor())
        assert outcome.status == "down"
        assert outcome.error_type == "connection_error"

    def test_dns_error_classified(self):
        def handler(request):
            raise httpx.ConnectError("getaddrinfo failed") from socket.gaierror()

        outcome = make_checker(handler).check(make_monitor())
        assert outcome.status == "down"
        assert outcome.error_type == "dns_error"

    def test_tls_error_classified(self):
        def handler(request):
            raise httpx.ConnectError("certificate verify failed") from ssl.SSLCertVerificationError(
                "certificate verify failed"
            )

        outcome = make_checker(handler).check(make_monitor())
        assert outcome.status == "down"
        assert outcome.error_type == "tls_error"


class TestRetries:
    def test_transient_failure_retried_then_up(self):
        calls = {"n": 0}

        def handler(request):
            calls["n"] += 1
            if calls["n"] < 3:
                raise httpx.ConnectError("flaky")
            return httpx.Response(200)

        checker = make_checker(handler, check_max_retries=2)
        outcome = checker.check(make_monitor())
        assert outcome.status == "up"
        assert calls["n"] == 3

    def test_persistent_failure_returns_down_after_all_retries(self):
        calls = {"n": 0}

        def handler(request):
            calls["n"] += 1
            raise httpx.ConnectError("down hard")

        checker = make_checker(handler, check_max_retries=2)
        outcome = checker.check(make_monitor())
        assert outcome.status == "down"
        assert calls["n"] == 3  # 1 initial + 2 retries

    def test_backoff_is_exponential(self):
        sleeps: list[float] = []

        def handler(request):
            raise httpx.ConnectError("down")

        checker = make_checker(handler, check_max_retries=2, check_retry_backoff_seconds=2.0)
        checker._sleep = sleeps.append
        checker.check(make_monitor())
        assert sleeps == [2.0, 4.0]

    def test_status_mismatch_not_retried(self):
        calls = {"n": 0}

        def handler(request):
            calls["n"] += 1
            return httpx.Response(500)

        checker = make_checker(handler, check_max_retries=3)
        checker.check(make_monitor())
        assert calls["n"] == 1


class TestRedirects:
    def test_redirect_followed(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/start":
                return httpx.Response(301, headers={"Location": "/final"})
            return httpx.Response(200, text="arrived")

        outcome = make_checker(handler).check(
            make_monitor(target_url="https://api.example.com/start")
        )
        assert outcome.status == "up"
        assert outcome.http_status == 200

    def test_redirect_to_private_ip_blocked(self):
        def handler(request):
            return httpx.Response(302, headers={"Location": "http://127.0.0.1/admin"})

        outcome = make_checker(handler).check(
            make_monitor(target_url="https://api.example.com/redirect")
        )
        assert outcome.status == "down"
        assert outcome.error_type == "connection_error"
        assert "not allowed" in outcome.error_message

    def test_too_many_redirects(self):
        def handler(request):
            return httpx.Response(302, headers={"Location": "/loop"})

        outcome = make_checker(handler).check(
            make_monitor(target_url="https://api.example.com/loop")
        )
        assert outcome.status == "down"
        assert outcome.error_type == "connection_error"


class TestResponseSize:
    def test_oversized_response_rejected(self):
        checker = make_checker(
            lambda request: httpx.Response(200, text="x" * 1000), max_response_bytes=100
        )
        outcome = checker.check(make_monitor())
        assert outcome.status == "down"
        assert outcome.error_type == "response_too_large"


class TestKeywordCheck:
    def test_keyword_pass(self):
        checker = make_checker(
            lambda request: httpx.Response(200, text="<body>Example Domain here</body>")
        )
        outcome = checker.check(make_monitor(keyword="Example Domain", keyword_mode="contains"))
        assert outcome.status == "up"
        assert outcome.keyword_result == "pass"

    def test_keyword_fail_is_down(self):
        checker = make_checker(lambda request: httpx.Response(200, text="nothing here"))
        outcome = checker.check(make_monitor(keyword="Example Domain", keyword_mode="contains"))
        assert outcome.status == "down"
        assert outcome.error_type == "keyword_failed"
        assert outcome.keyword_result == "fail"

    def test_keyword_type_monitor(self):
        checker = make_checker(lambda request: httpx.Response(200, text="hello"))
        monitor = make_monitor(type="keyword", keyword="hello")
        assert checker.check(monitor).status == "up"

    def test_http_200_keyword_fail_marks_down(self):
        """Documented rule: keyword failure on HTTP 200 is DOWN."""
        checker = make_checker(lambda request: httpx.Response(200, text="parked page"))
        outcome = checker.check(make_monitor(keyword="real content", keyword_mode="contains"))
        assert outcome.status == "down"


class TestJsonCheck:
    def test_json_check_pass(self):
        body = b'{"userId": 1, "id": 1, "completed": false}'
        checker = make_checker(lambda request: httpx.Response(200, content=body))
        monitor = make_monitor(type="api_json", json_path="completed", json_expected_value="false")
        outcome = checker.check(monitor)
        assert outcome.status == "up"
        assert outcome.json_result == "pass"

    def test_json_mismatch_is_down(self):
        body = b'{"completed": true}'
        checker = make_checker(lambda request: httpx.Response(200, content=body))
        monitor = make_monitor(type="api_json", json_path="completed", json_expected_value="false")
        outcome = checker.check(monitor)
        assert outcome.status == "down"
        assert outcome.error_type == "json_failed"

    def test_invalid_json_is_down(self):
        checker = make_checker(lambda request: httpx.Response(200, text="<html></html>"))
        monitor = make_monitor(type="api_json", json_path="completed")
        outcome = checker.check(monitor)
        assert outcome.status == "down"
        assert outcome.error_type == "json_parse_failed"


class TestSslSidecar:
    def test_ssl_info_collected_when_enabled(self):
        checker = make_checker(lambda request: httpx.Response(200), )
        checker._ssl_checker = FakeSSLChecker(days_remaining=90)
        monitor = make_monitor(ssl_check_enabled=True)
        outcome = checker.check(monitor)
        assert outcome.status == "up"
        assert outcome.ssl_status == "valid"
        assert outcome.ssl_days_remaining == 90
        assert outcome.ssl_expires_at is not None

    def test_expiring_soon_classification(self):
        checker = make_checker(lambda request: httpx.Response(200))
        checker._ssl_checker = FakeSSLChecker(days_remaining=17)
        monitor = make_monitor(ssl_check_enabled=True)
        outcome = checker.check(monitor)
        assert outcome.status == "up"  # expiring cert does NOT flip status
        assert outcome.ssl_status == "expiring_soon"

    def test_ssl_failure_does_not_flip_status(self):
        checker = make_checker(lambda request: httpx.Response(200))
        checker._ssl_checker = FakeSSLChecker(error=SSLCheckError("timeout", "slow"))
        monitor = make_monitor(ssl_check_enabled=True)
        outcome = checker.check(monitor)
        assert outcome.status == "up"
        assert outcome.ssl_status == "unknown"

    def test_ssl_not_applicable_for_http(self):
        checker = make_checker(lambda request: httpx.Response(200))
        monitor = make_monitor(ssl_check_enabled=True, target_url="http://api.example.com/")
        outcome = checker.check(monitor)
        assert outcome.ssl_status == "not_applicable"


class TestSslOnlyMonitors:
    def test_valid_certificate(self):
        checker = HTTPChecker(ssl_checker=FakeSSLChecker(days_remaining=90))
        monitor = make_monitor(type="ssl", target_url="https://api.example.com/")
        outcome = checker.check(monitor)
        assert outcome.status == "up"
        assert outcome.ssl_status == "valid"

    def test_expired_certificate_is_down(self):
        checker = HTTPChecker(ssl_checker=FakeSSLChecker(days_remaining=-3))
        monitor = make_monitor(type="ssl", target_url="https://api.example.com/")
        outcome = checker.check(monitor)
        assert outcome.status == "down"
        assert outcome.error_type == "ssl_expired"
        assert outcome.ssl_status == "expired"

    def test_unreachable_is_down(self):
        checker = HTTPChecker(
            ssl_checker=FakeSSLChecker(error=SSLCheckError("unreachable", "refused"))
        )
        monitor = make_monitor(type="ssl", target_url="https://api.example.com/")
        outcome = checker.check(monitor)
        assert outcome.status == "down"
        assert outcome.error_type == "tls_error"

    def test_timeout_is_down(self):
        checker = HTTPChecker(ssl_checker=FakeSSLChecker(error=SSLCheckError("timeout", "slow")))
        monitor = make_monitor(type="ssl", target_url="https://api.example.com/")
        outcome = checker.check(monitor)
        assert outcome.status == "down"
        assert outcome.error_type == "timeout"


class TestClassify:
    @pytest.mark.parametrize(
        "days,warning,expected",
        [
            (90, 30, "valid"),
            (30, 30, "expiring_soon"),
            (17, 30, "expiring_soon"),
            (0, 30, "expiring_soon"),
            (-1, 30, "expired"),
            (None, 30, "unknown"),
        ],
    )
    def test_classification(self, days, warning, expected):
        assert classify_ssl_status(days, warning) == expected
