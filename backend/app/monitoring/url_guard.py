"""SSRF protection for URLs the server is asked to contact.

Validation is based on standard ``ipaddress`` parsing of *resolved* addresses
(not string matching): the host must resolve, and every resolved address must be
a public/global IP. Loopback, private, link-local (incl. cloud metadata
169.254.169.254), multicast, reserved and unspecified ranges are rejected, for
both IPv4 and IPv6 (including IPv4-mapped IPv6).

Known limitation (documented in README): the hostname is re-resolved by the HTTP
client afterwards, so a DNS-rebinding race cannot be fully eliminated without
connect-IP pinning.
"""

import ipaddress
import socket
from urllib.parse import urlsplit

from app.api.errors import ApiError

ALLOWED_SCHEMES = ("http", "https")

_BLOCKED_HOSTNAMES = {
    "localhost",
    "metadata.google.internal",
    "metadata.goog",
}

MAX_URL_LENGTH = 2048
MAX_HOST_LENGTH = 255


class UrlValidationError(ApiError):
    def __init__(self, message: str):
        super().__init__(400, "invalid_url", message)


def _is_blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped
    return (
        not ip.is_global
        or ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _resolved_addresses(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UrlValidationError(f"Cannot resolve host '{host}'") from exc
    except OSError as exc:
        raise UrlValidationError(f"DNS lookup failed for '{host}'") from exc
    addresses: list = []
    for family, _type, _proto, _canonname, sockaddr in infos:
        if family not in (socket.AF_INET, socket.AF_INET6):
            continue
        addresses.append(ipaddress.ip_address(sockaddr[0]))
    return addresses


def validate_public_http_url(
    url: str, *, allow_private: bool = False, resolve_host: bool = True
) -> str:
    """Validate that *url* is a safe http(s) target and return it (stripped).

    Raises UrlValidationError (HTTP 400) when the URL is not acceptable.
    """
    if not url or not url.strip():
        raise UrlValidationError("URL is required")
    url = url.strip()
    # urllib.parse.urlsplit silently strips TAB/CR/LF while httpx rejects them
    # with InvalidURL. Without this check such a URL is accepted at creation
    # and then fails every check as an "internal_error" DOWN.
    if any(ord(char) < 0x20 or ord(char) == 0x7F for char in url):
        raise UrlValidationError("URL contains control characters")
    if len(url) > MAX_URL_LENGTH:
        raise UrlValidationError("URL is too long")

    try:
        parts = urlsplit(url)
    except ValueError as exc:
        # urlsplit() itself raises on malformed IPv6 literals such as
        # "http://[invalid/" — before .hostname is ever accessed.
        raise UrlValidationError(f"Malformed URL: {exc}") from exc
    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        raise UrlValidationError("URL scheme must be http or https")
    if parts.username or parts.password:
        raise UrlValidationError("Credentials embedded in URLs are not allowed")

    # ``.hostname`` / ``.port`` raise ValueError for malformed IPv6 literals,
    # non-numeric or out-of-range ports. Surface those as a clean 400 instead
    # of letting them escape as an unhandled 500 (or crash a checker).
    try:
        host = parts.hostname
        port = parts.port
    except ValueError as exc:
        raise UrlValidationError(f"Malformed URL: {exc}") from exc
    if port is not None and not 0 < port <= 65535:
        raise UrlValidationError("URL port must be between 1 and 65535")
    if not host:
        raise UrlValidationError("URL has no host")
    host = host.rstrip(".")
    if len(host) > MAX_HOST_LENGTH:
        raise UrlValidationError("URL host is too long")
    if host.lower() in _BLOCKED_HOSTNAMES or host.lower().endswith(".localhost"):
        raise UrlValidationError(f"Host '{host}' is not allowed")

    # Literal IP targets are checked directly — never resolved via DNS.
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not allow_private and _is_blocked_ip(literal):
            raise UrlValidationError(f"IP address '{host}' is not allowed")
        return url

    if allow_private or not resolve_host:
        return url

    addresses = _resolved_addresses(host)
    if not addresses:
        raise UrlValidationError(f"Cannot resolve host '{host}'")
    for ip in addresses:
        if _is_blocked_ip(ip):
            raise UrlValidationError(
                f"Host '{host}' resolves to a forbidden address ({ip})"
            )
    return url


def validate_webhook_url(url: str, *, allow_private: bool) -> str:
    """Webhook endpoints are user-supplied too — same scheme rules apply."""
    return validate_public_http_url(url, allow_private=allow_private)
