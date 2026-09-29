import socket

import pytest

from app.monitoring.url_guard import UrlValidationError, validate_public_http_url


def guard(url, **kw):
    return validate_public_http_url(url, **kw)


class TestScheme:
    @pytest.mark.parametrize("url", ["ftp://example.com", "file:///etc/passwd", "gopher://x.example"])
    def test_rejects_non_http_schemes(self, url):
        with pytest.raises(UrlValidationError):
            guard(url, resolve_host=False)

    @pytest.mark.parametrize("url", ["", "   ", "not a url"])
    def test_rejects_garbage(self, url):
        with pytest.raises(UrlValidationError):
            guard(url, resolve_host=False)

    def test_missing_host(self):
        with pytest.raises(UrlValidationError):
            guard("http://", resolve_host=False)

    def test_embedded_credentials_rejected(self):
        with pytest.raises(UrlValidationError):
            guard("http://user:pass@example.com/", resolve_host=False)

    def test_accepts_http_and_https(self):
        assert guard("https://example.com/", resolve_host=False) == "https://example.com/"
        assert guard("http://example.com/", resolve_host=False) == "http://example.com/"


class TestBlockedHostnames:
    @pytest.mark.parametrize(
        "url",
        [
            "http://localhost/",
            "http://LOCALHOST:8000/",
            "http://foo.localhost/",
            "http://metadata.google.internal/",
        ],
    )
    def test_rejects_local_and_metadata_hosts(self, url):
        with pytest.raises(UrlValidationError):
            guard(url, resolve_host=False)

    def test_trailing_dot_localhost_blocked(self):
        with pytest.raises(UrlValidationError):
            guard("http://localhost./", resolve_host=False)


class TestLiteralIPs:
    @pytest.mark.parametrize(
        "url",
        [
            "http://127.0.0.1/",
            "http://127.0.0.1:8080/",
            "http://10.0.0.1/",
            "http://192.168.1.1/",
            "http://172.16.0.5/",
            "http://172.31.255.255/",
            "http://169.254.169.254/latest/meta-data/",
            "http://0.0.0.0/",
            "http://100.64.0.1/",
            "http://[::1]/",
            "http://[fe80::1]/",
            "http://[fc00::1]/",
            "http://[::ffff:10.0.0.1]/",
            "http://224.0.0.1/",
        ],
    )
    def test_rejects_private_and_special_ranges(self, url):
        with pytest.raises(UrlValidationError):
            guard(url)

    def test_allows_public_literal_ips(self):
        assert guard("http://8.8.8.8/") == "http://8.8.8.8/"
        assert guard("http://[2606:4700::1111]/") == "http://[2606:4700::1111]/"


class TestDnsResolution:
    def test_rejects_host_resolving_to_private_ip(self, monkeypatch):
        def fake(host, *a, **kw):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.0.10", 0))]

        monkeypatch.setattr(socket, "getaddrinfo", fake)
        with pytest.raises(UrlValidationError, match="forbidden address"):
            guard("http://internal.example.com/")

    def test_rejects_host_resolving_to_metadata_ip(self, monkeypatch):
        def fake(host, *a, **kw):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("169.254.169.254", 0))]

        monkeypatch.setattr(socket, "getaddrinfo", fake)
        with pytest.raises(UrlValidationError):
            guard("http://evil.example.com/")

    def test_rejects_unresolvable_host(self, monkeypatch):
        def fake(host, *a, **kw):
            raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")

        monkeypatch.setattr(socket, "getaddrinfo", fake)
        with pytest.raises(UrlValidationError, match="Cannot resolve"):
            guard("http://nope.example.com/")

    def test_accepts_host_resolving_to_public_ip(self, monkeypatch):
        def fake(host, *a, **kw):
            return [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0)),
                (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("2606:2800:220:1::1", 0, 0, 0)),
            ]

        monkeypatch.setattr(socket, "getaddrinfo", fake)
        assert guard("http://example.com/") == "http://example.com/"

    def test_allow_private_flag_skips_resolution_checks(self, monkeypatch):
        def fake(host, *a, **kw):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.1.2.3", 0))]

        monkeypatch.setattr(socket, "getaddrinfo", fake)
        assert guard("http://intranet.example.com/", allow_private=True) is not None


class TestWebhookValidation:
    def test_webhook_rejects_private_by_default(self, monkeypatch):
        def fake(host, *a, **kw):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 0))]

        monkeypatch.setattr(socket, "getaddrinfo", fake)
        with pytest.raises(UrlValidationError):
            guard("http://collector.internal/hook")

    def test_url_length_limit(self):
        with pytest.raises(UrlValidationError):
            guard("http://example.com/" + "a" * 3000, resolve_host=False)
