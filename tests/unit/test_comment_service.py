from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from backend.presentation.schemas.comment_schemas import CommentCreate, CommentUpdate
from backend.services.comment_service import CommentNotEditableError, CommentService

pytestmark = pytest.mark.unit


def _make_service_with_repo(repo) -> CommentService:
    service = CommentService(session=object())
    service.repo = repo
    return service


@pytest.mark.asyncio
async def test_create_comment_uses_resolved_identity_instead_of_payload_identity():
    created_comment = SimpleNamespace(id=7)
    repo = SimpleNamespace(create=AsyncMock(return_value=created_comment))
    service = _make_service_with_repo(repo)
    payload = SimpleNamespace(
        anchor_key="pos-84-13",
        selected_text="texto selecionado",
        body="comentario",
        is_private=False,
        user_name="Spoofed User",
        user_image_url="https://attacker.example/avatar.png",
    )

    result = await service.create_comment(
        payload,
        "tenant-1",
        "user-1",
        user_name="JWT User",
        user_image_url="https://issuer.example/avatar.png",
    )

    assert result is created_comment
    repo.create.assert_awaited_once()
    stored = repo.create.await_args.args[0]
    assert stored.user_name == "JWT User"
    assert stored.user_image_url == "https://issuer.example/avatar.png"
    assert stored.user_name != payload.user_name
    assert stored.user_image_url != payload.user_image_url


@pytest.mark.asyncio
async def test_list_for_anchor_returns_repository_result_unchanged():
    expected = [SimpleNamespace(id=1), SimpleNamespace(id=2)]
    repo = SimpleNamespace(list_by_anchor=AsyncMock(return_value=expected))
    service = _make_service_with_repo(repo)

    result = await service.list_for_anchor("tenant-1", "pos-84-13", "user-1")

    assert result == expected
    repo.list_by_anchor.assert_awaited_once_with(
        "tenant-1", "pos-84-13", "user-1", limit=200, offset=0
    )


@pytest.mark.asyncio
async def test_delete_comment_raises_when_comment_is_missing():
    repo = SimpleNamespace(
        get_by_id_and_tenant=AsyncMock(return_value=None),
        delete=AsyncMock(),
    )
    service = _make_service_with_repo(repo)

    with pytest.raises(ValueError, match="Comentário não encontrado"):
        await service.delete_comment(7, "tenant-1", "user-1")

    repo.get_by_id_and_tenant.assert_awaited_once_with(7, "tenant-1")
    repo.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_comment_raises_when_tenant_does_not_match():
    repo = SimpleNamespace(
        get_by_id_and_tenant=AsyncMock(return_value=None),
        delete=AsyncMock(),
    )
    service = _make_service_with_repo(repo)

    with pytest.raises(ValueError, match="Comentário não encontrado"):
        await service.delete_comment(7, "tenant-1", "user-1")

    repo.get_by_id_and_tenant.assert_awaited_once_with(7, "tenant-1")
    repo.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_comment_raises_when_user_is_not_author():
    comment = SimpleNamespace(tenant_id="tenant-1", user_id="user-2")
    repo = SimpleNamespace(
        get_by_id_and_tenant=AsyncMock(return_value=comment),
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
        get_by_id_and_tenant=AsyncMock(return_value=comment),
        delete=AsyncMock(),
    )
    service = _make_service_with_repo(repo)

    await service.delete_comment(7, "tenant-1", "user-1")

    repo.get_by_id_and_tenant.assert_awaited_once_with(7, "tenant-1")
    repo.delete.assert_awaited_once_with(comment)


def test_comment_create_rejects_html_body():
    with pytest.raises(ValidationError):
        CommentCreate(
            anchor_key="pos-84-13",
            selected_text="texto",
            body="<script>alert(1)</script>",
            is_private=False,
        )


def test_comment_create_allows_angle_brackets_that_are_not_html_tags():
    payload = CommentCreate(
        anchor_key="pos-84-13",
        selected_text="valor < outro valor",
        body="Use <comparacao sem fechamento proximo ou <123 aninhado> seguro",
        is_private=False,
    )

    assert payload.body.startswith("Use <comparacao")


@pytest.mark.asyncio
async def test_update_comment_rejected_raises_not_editable_error():
    comment = SimpleNamespace(tenant_id="tenant-1", user_id="user-1", status="rejected")
    repo = SimpleNamespace(
        get_by_id_and_tenant=AsyncMock(return_value=comment),
        update_body=AsyncMock(),
    )
    service = _make_service_with_repo(repo)

    with pytest.raises(CommentNotEditableError):
        await service.update_comment(
            7,
            CommentUpdate(body="novo comentario"),
            "tenant-1",
            "user-1",
        )

    repo.update_body.assert_not_awaited()


def test_comment_create_rejects_invalid_anchor_key():
    with pytest.raises(ValidationError):
        CommentCreate(
            anchor_key="../../etc/passwd",
            selected_text="texto",
            body="comentario",
            is_private=False,
        )


def test_comment_create_rejects_legacy_identity_fields():
    with pytest.raises(ValidationError):
        CommentCreate(
            anchor_key="pos-84-13",
            selected_text="texto",
            body="comentario",
            is_private=False,
            user_name="Spoofed",
        )
