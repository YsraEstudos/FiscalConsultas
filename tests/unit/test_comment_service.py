from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.services.comment_service import CommentService

pytestmark = pytest.mark.unit


def _make_service_with_repo(repo) -> CommentService:
    service = CommentService(session=object())
    service.repo = repo
    return service


@pytest.mark.asyncio
async def test_list_for_anchor_returns_repository_result_unchanged():
    expected = [SimpleNamespace(id=1), SimpleNamespace(id=2)]
    repo = SimpleNamespace(list_by_anchor=AsyncMock(return_value=expected))
    service = _make_service_with_repo(repo)

    result = await service.list_for_anchor("tenant-1", "pos-84-13", "user-1")

    assert result == expected
    repo.list_by_anchor.assert_awaited_once_with("tenant-1", "pos-84-13", "user-1")


@pytest.mark.asyncio
async def test_delete_comment_raises_when_comment_is_missing():
    repo = SimpleNamespace(
        get_by_id=AsyncMock(return_value=None),
        delete=AsyncMock(),
    )
    service = _make_service_with_repo(repo)

    with pytest.raises(ValueError, match="Comentário 7 não encontrado"):
        await service.delete_comment(7, "tenant-1", "user-1")

    repo.get_by_id.assert_awaited_once_with(7)
    repo.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_comment_raises_when_tenant_does_not_match():
    comment = SimpleNamespace(tenant_id="tenant-2", user_id="user-1")
    repo = SimpleNamespace(
        get_by_id=AsyncMock(return_value=comment),
        delete=AsyncMock(),
    )
    service = _make_service_with_repo(repo)

    with pytest.raises(PermissionError, match="Sem permissão"):
        await service.delete_comment(7, "tenant-1", "user-1")

    repo.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_comment_raises_when_user_is_not_author():
    comment = SimpleNamespace(tenant_id="tenant-1", user_id="user-2")
    repo = SimpleNamespace(
        get_by_id=AsyncMock(return_value=comment),
        delete=AsyncMock(),
    )
    service = _make_service_with_repo(repo)

    with pytest.raises(PermissionError, match="Somente o autor pode deletar"):
        await service.delete_comment(7, "tenant-1", "user-1")

    repo.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_comment_deletes_comment_when_authorized():
    comment = SimpleNamespace(tenant_id="tenant-1", user_id="user-1")
    repo = SimpleNamespace(
        get_by_id=AsyncMock(return_value=comment),
        delete=AsyncMock(),
    )
    service = _make_service_with_repo(repo)

    await service.delete_comment(7, "tenant-1", "user-1")

    repo.get_by_id.assert_awaited_once_with(7)
    repo.delete.assert_awaited_once_with(comment)
