def metric_value_from_status(status: str) -> int:
    return 1 if status == "online" else 0


def append_metric_line(
    lines: list[str],
    name: str,
    value: int | float,
    labels: dict[str, str] | None = None,
) -> None:
    label_text = ""
    if labels:

        def _escape_label_value(label_value: str) -> str:
            return (
                label_value.replace("\\", "\\\\")
                .replace('"', '\\"')
                .replace("\n", "\\n")
            )

        encoded_labels = ",".join(
            f'{key}="{_escape_label_value(str(label_value))}"'
            for key, label_value in sorted(labels.items())
        )
        label_text = f"{{{encoded_labels}}}"
    lines.append(f"{name}{label_text} {value}")


def append_catalog_status_metrics(lines: list[str], status_payload: dict) -> None:
    catalogs = status_payload.get("catalogs", {})
    for catalog_name, catalog_payload in catalogs.items():
        if not isinstance(catalog_payload, dict):
            continue
        append_metric_line(
            lines,
            "nesh_catalog_status",
            metric_value_from_status(str(catalog_payload.get("status", "error"))),
            {"catalog": catalog_name},
        )


def append_database_latency_metric(lines: list[str], status_payload: dict) -> None:
    database_payload = status_payload.get("database", {})
    if not isinstance(database_payload, dict) or "latency_ms" not in database_payload:
        return
    lines.extend(
        [
            "# HELP nesh_database_latency_ms Database latency observed by /api/status/details.",
            "# TYPE nesh_database_latency_ms gauge",
        ]
    )
    append_metric_line(
        lines,
        "nesh_database_latency_ms",
        float(database_payload.get("latency_ms") or 0),
    )


def append_payload_cache_metrics(
    lines: list[str],
    cache_metrics: dict,
    *,
    metric_name: str,
    help_text: str,
    field_name: str,
) -> None:
    lines.extend(
        [
            f"# HELP {metric_name} {help_text}",
            f"# TYPE {metric_name} gauge",
        ]
    )
    for cache_name in ("search_code_payload_cache", "tipi_code_payload_cache"):
        cache_payload = cache_metrics.get(cache_name)
        if not isinstance(cache_payload, dict):
            continue
        append_metric_line(
            lines,
            metric_name,
            int(cache_payload.get(field_name) or 0),
            {"cache": cache_name},
        )


def append_internal_cache_hit_rate_metrics(
    lines: list[str], cache_metrics: dict
) -> None:
    lines.extend(
        [
            "# HELP nesh_internal_cache_hit_rate Internal service cache hit rate.",
            "# TYPE nesh_internal_cache_hit_rate gauge",
        ]
    )
    for service_name in ("nesh_internal_caches", "tipi_internal_caches"):
        service_payload = cache_metrics.get(service_name)
        if not isinstance(service_payload, dict):
            continue
        for cache_name, cache_payload in service_payload.items():
            if not isinstance(cache_payload, dict):
                continue
            hit_rate = cache_payload.get("hit_rate")
            if not isinstance(hit_rate, (int, float)):
                continue
            append_metric_line(
                lines,
                "nesh_internal_cache_hit_rate",
                float(hit_rate),
                {"service": service_name, "cache": cache_name},
            )


def build_prometheus_metrics_payload(status_payload: dict, cache_metrics: dict) -> str:
    lines: list[str] = [
        "# HELP nesh_catalog_status Catalog health status (1=online, 0=error).",
        "# TYPE nesh_catalog_status gauge",
    ]
    append_catalog_status_metrics(lines, status_payload)
    append_database_latency_metric(lines, status_payload)
    append_payload_cache_metrics(
        lines,
        cache_metrics,
        metric_name="nesh_payload_cache_hits",
        help_text="Total payload-cache hits by route family.",
        field_name="hits",
    )
    append_payload_cache_metrics(
        lines,
        cache_metrics,
        metric_name="nesh_payload_cache_misses",
        help_text="Total payload-cache misses by route family.",
        field_name="misses",
    )
    append_internal_cache_hit_rate_metrics(lines, cache_metrics)
    return "\n".join(lines) + "\n"
