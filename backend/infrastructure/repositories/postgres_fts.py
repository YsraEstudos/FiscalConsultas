from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PostgresTsQuerySpec:
    sql: str
    params: dict[str, str]


def _normalize_prefix_token(token: str) -> str:
    cleaned = token.strip().strip('"').strip("'")
    if not cleaned:
        return ""
    if cleaned.endswith("*"):
        cleaned = cleaned[:-1]
        if not cleaned:
            return ""
        return f"{cleaned}:*"
    return cleaned


def _join_and_terms(text: str) -> str:
    terms = [_normalize_prefix_token(part) for part in text.split()]
    terms = [term for term in terms if term]
    return " & ".join(terms)


def build_postgres_tsquery(query: str) -> PostgresTsQuerySpec:
    stripped = query.strip()

    if stripped.startswith('"') and stripped.endswith('"') and len(stripped) >= 2:
        return PostgresTsQuerySpec(
            sql="phraseto_tsquery('portuguese', :query)",
            params={"query": stripped[1:-1]},
        )

    if " OR " in stripped:
        groups = [_join_and_terms(part) for part in stripped.split(" OR ")]
        tsquery = " | ".join(group for group in groups if group)
        return PostgresTsQuerySpec(
            sql="to_tsquery('portuguese', :tsquery)",
            params={"tsquery": tsquery},
        )

    if "*" in stripped:
        return PostgresTsQuerySpec(
            sql="to_tsquery('portuguese', :tsquery)",
            params={"tsquery": _join_and_terms(stripped)},
        )

    return PostgresTsQuerySpec(
        sql="plainto_tsquery('portuguese', :query)",
        params={"query": stripped},
    )
