"""Network helpers used by the server middleware and lifecycle checks."""

from __future__ import annotations

import ipaddress
from typing import Optional
from urllib.parse import urlparse

_LOCALHOST_HOSTS = {"localhost"}


def is_loopback_host(host: Optional[str]) -> bool:
    if not host:
        return False

    normalized = str(host).strip().lower()
    if not normalized:
        return False

    if normalized in _LOCALHOST_HOSTS:
        return True

    if "%" in normalized:
        normalized = normalized.split("%", 1)[0]

    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    mapped_ipv4 = getattr(ip, "ipv4_mapped", None)
    return ip.is_loopback or bool(mapped_ipv4 and mapped_ipv4.is_loopback)


def origin_looks_like_loopback(origin: str) -> bool:
    return is_loopback_host(urlparse(origin).hostname)
