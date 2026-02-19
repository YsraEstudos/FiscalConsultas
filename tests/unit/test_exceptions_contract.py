import pytest

from backend.config.exceptions import (
    ChapterNotFoundError,
    ConfigurationError,
    DatabaseError,
    DatabaseNotFoundError,
    InvalidQueryError,
    NeshError,
    NotFoundError,
    ServiceError,
    ValidationError,
)


pytestmark = pytest.mark.unit


def test_nesh_error_defaults():
    exc = NeshError("oops")
    assert exc.message == "oops"
    assert exc.code == "NESH_ERROR"
    assert exc.status_code == 500


def test_configuration_error_contract():
    exc = ConfigurationError("bad config")
    assert exc.code == "CONFIG_ERROR"
    assert exc.status_code == 500
    assert "bad config" in str(exc)


def test_database_error_contract():
    exc = DatabaseError("db down")
    assert exc.code == "DB_ERROR"
    assert exc.status_code == 503


def test_database_not_found_error_contract():
    exc = DatabaseNotFoundError("/tmp/nesh.db")
    assert exc.code == "DB_ERROR"
    assert exc.status_code == 503
    assert exc.path == "/tmp/nesh.db"
    assert "não encontrado" in exc.message


def test_chapter_not_found_error_contract():
    exc = ChapterNotFoundError("85")
    assert exc.code == "CHAPTER_NOT_FOUND"
    assert exc.status_code == 404
    assert exc.chapter_num == "85"


def test_invalid_query_error_contract():
    exc = InvalidQueryError("x", reason="invalida")
    assert exc.code == "INVALID_QUERY"
    assert exc.status_code == 400
    assert exc.query == "x"
    assert "invalida" in exc.message


def test_validation_error_contract():
    exc = ValidationError("bad field", field="ncm")
    assert exc.code == "VALIDATION_ERROR"
    assert exc.status_code == 400
    assert exc.field == "ncm"


def test_service_error_contract():
    exc = ServiceError("service failed", service="AI")
    assert exc.code == "SERVICE_ERROR"
    assert exc.status_code == 500
    assert exc.service == "AI"


def test_not_found_error_with_identifier():
    exc = NotFoundError("Recurso", "abc")
    assert exc.code == "NOT_FOUND"
    assert exc.status_code == 404
    assert exc.resource == "Recurso"
    assert exc.identifier == "abc"
    assert "'abc'" in exc.message


def test_not_found_error_without_identifier():
    exc = NotFoundError("Recurso")
    assert exc.identifier is None
    assert exc.message == "Recurso não encontrado"
