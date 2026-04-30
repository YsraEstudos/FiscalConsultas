from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import text

from .common import build_nbs_tenant_params, build_nbs_tenant_predicate_sql
from .types import NbsCatalogCountsSnapshot, NbsCatalogMetadataSnapshot

if TYPE_CHECKING:
    from backend.infrastructure.repositories.nbs_repository import NbsRepository


async def snapshot_nbs_catalog_counts(
    repo: "NbsRepository",
) -> NbsCatalogCountsSnapshot:
    tenant_params = build_nbs_tenant_params(repo.tenant_id)
    nbs_sql = (
        "SELECT COUNT(*) AS total FROM nbs_items WHERE 1=1"
        f"{build_nbs_tenant_predicate_sql(repo.tenant_id, 'nbs_items')}"
    )
    nebs_sql = (
        "SELECT COUNT(*) AS total FROM nebs_entries WHERE 1=1"
        f"{build_nbs_tenant_predicate_sql(repo.tenant_id, 'nebs_entries')}"
    )
    nbs_result = await repo.session.execute(text(nbs_sql), tenant_params)
    nebs_result = await repo.session.execute(text(nebs_sql), tenant_params)
    return {
        "nbs_items": int(nbs_result.scalar() or 0),
        "nebs_entries": int(nebs_result.scalar() or 0),
    }


async def snapshot_nbs_catalog_metadata(
    repo: "NbsRepository",
) -> NbsCatalogMetadataSnapshot:
    sql = (
        "SELECT key, value FROM catalog_metadata WHERE 1=1"
        f"{build_nbs_tenant_predicate_sql(repo.tenant_id, 'catalog_metadata')}"
        " ORDER BY key ASC, CASE WHEN tenant_id IS NULL THEN 0 ELSE 1 END ASC"
    )
    result = await repo.session.execute(
        text(sql), build_nbs_tenant_params(repo.tenant_id)
    )
    return {row.key: row.value for row in result}
