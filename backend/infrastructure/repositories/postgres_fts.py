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


def _empty_tsquery_spec() -> PostgresTsQuerySpec:
    # Keep the fragment typed as tsquery so repositories can reuse it in both
    # ts_rank(...) and @@ predicates without calling to_tsquery on an empty input.
    return PostgresTsQuerySpec(sql="NULL::tsquery", params={})


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
        if not tsquery:
            return _empty_tsquery_spec()
        return PostgresTsQuerySpec(
            sql="to_tsquery('portuguese', :tsquery)",
            params={"tsquery": tsquery},
        )

    if "*" in stripped:
        tsquery = _join_and_terms(stripped)
        if not tsquery:
            return _empty_tsquery_spec()
        return PostgresTsQuerySpec(
            sql="to_tsquery('portuguese', :tsquery)",
            params={"tsquery": tsquery},
        )

    return PostgresTsQuerySpec(
        sql="plainto_tsquery('portuguese', :query)",
        params={"query": stripped},
    )
