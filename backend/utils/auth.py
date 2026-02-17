from __future__ import annotations

import ipaddress
from collections.abc import Mapping
from typing import Any

from fastapi import Request

from backend.config.settings import settings


def extract_bearer_token(request: Request) -> str | None:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header[7:].strip()
    return token or None


def _iter_roles(payload: Mapping[str, Any]) -> list[str]:
    candidates: list[str] = []
    for key in ("role", "org_role"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            candidates.append(value.strip().lower())

    roles_value = payload.get("roles")
    if isinstance(roles_value, str) and roles_value.strip():
        candidates.append(roles_value.strip().lower())
    elif isinstance(roles_value, list):
        for item in roles_value:
            if isinstance(item, str) and item.strip():
                candidates.append(item.strip().lower())

    return candidates


def is_admin_payload(payload: Mapping[str, Any] | None) -> bool:
    if not payload:
        return False
    roles = set(_iter_roles(payload))
    return bool(roles.intersection({"admin", "owner", "superadmin"}))


def _load_trusted_proxy_networks() -> list[Any]:
    raw_values = list(settings.security.trusted_proxy_ips or [])
    if settings.server.env == "development":
        raw_values.extend(["127.0.0.1/32", "::1/128"])

    networks: list[Any] = []
    for raw in raw_values:
        if not raw:
            continue
        value = str(raw).strip()
        if not value:
            continue
        try:
            if "/" in value:
                networks.append(ipaddress.ip_network(value, strict=False))
            else:
                ip = ipaddress.ip_address(value)
                suffix = "/32" if ip.version == 4 else "/128"
                networks.append(ipaddress.ip_network(f"{value}{suffix}", strict=False))
        except ValueError:
            continue
    return networks


def _is_trusted_proxy(ip_text: str | None) -> bool:
    if not ip_text:
        return False
    try:
        ip = ipaddress.ip_address(ip_text)
    except ValueError:
        return False
    for network in _load_trusted_proxy_networks():
        if ip in network:
            return True
    return False


def extract_client_ip(request: Request) -> str:
    direct_ip = request.client.host if request.client and request.client.host else None
    forwarded_for = request.headers.get("X-Forwarded-For", "").strip()

    # We only trust X-Forwarded-For when the immediate peer is a trusted proxy.
    if forwarded_for and _is_trusted_proxy(direct_ip):
        first_hop = forwarded_for.split(",", 1)[0].strip()
        try:
            ipaddress.ip_address(first_hop)
            return first_hop
        except ValueError:
            pass

    return direct_ip or "unknown"
