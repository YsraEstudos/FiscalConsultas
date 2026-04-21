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
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


def origin_looks_like_loopback(origin: str) -> bool:
    return is_loopback_host(urlparse(origin).hostname)

