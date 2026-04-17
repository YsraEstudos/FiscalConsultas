import logging

import pytest
from backend.config import logging_config

pytestmark = pytest.mark.unit


def _clear_nesh_handlers():
    logger = logging.getLogger("nesh")
    for h in list(logger.handlers):
        logger.removeHandler(h)
        try:
            h.close()
        except Exception:
            pass


def test_setup_logging_handles_windows_stdout_reconfigure_failure(monkeypatch):
    class _BadStdout:
        def reconfigure(self, **_kwargs):
            raise RuntimeError("fail")

        def write(self, _data):
            return 0

        def flush(self):
            return None

    _clear_nesh_handlers()
    monkeypatch.setattr(logging_config.sys, "platform", "win32", raising=False)
    monkeypatch.setattr(logging_config.sys, "stdout", _BadStdout(), raising=False)

    logging_config.setup_logging(level=logging.DEBUG)
    logger = logging.getLogger("nesh")
    assert logger.level == logging.DEBUG
    assert len(logger.handlers) >= 1
    _clear_nesh_handlers()


def test_setup_logging_adds_file_handler_when_log_file_provided(monkeypatch, tmp_path):
    _clear_nesh_handlers()
    monkeypatch.setattr(logging_config.sys, "platform", "linux", raising=False)
    log_file = str(tmp_path / "nesh.log")

    try:
        logging_config.setup_logging(log_file=log_file)
        logger = logging.getLogger("nesh")
        assert any(isinstance(h, logging.FileHandler) for h in logger.handlers)
    finally:
        _clear_nesh_handlers()


def test_setup_logging_does_not_duplicate_managed_handlers(monkeypatch):
    _clear_nesh_handlers()
    monkeypatch.setattr(logging_config.sys, "platform", "linux", raising=False)

    logging_config.setup_logging(level="INFO")
    logging_config.setup_logging(level="DEBUG")

    logger = logging.getLogger("nesh")
    stream_handlers = [
        handler
        for handler in logger.handlers
        if isinstance(handler, logging.StreamHandler)
    ]
    assert len(stream_handlers) == 1
    assert logger.level == logging.DEBUG
    _clear_nesh_handlers()


def test_setup_logging_redacts_sensitive_values(monkeypatch, capsys):
    _clear_nesh_handlers()
    monkeypatch.setattr(logging_config.sys, "platform", "linux", raising=False)

    logging_config.setup_logging(level="INFO", redact_sensitive_data=True)
    logger = logging.getLogger("nesh")
    logger.info(
        "headers authorization=Bearer abc.def token=secret-value password=hunter2"
    )
    logger.info({"authorization": "Bearer jwt-token", "safe": "ok"})

    captured = capsys.readouterr()
    assert "abc.def" not in captured.out
    assert "secret-value" not in captured.out
    assert "hunter2" not in captured.out
    assert "[REDACTED]" in captured.out
    assert "ok" in captured.out
    _clear_nesh_handlers()


def test_get_logger_uses_nesh_prefix():
    logger = logging_config.get_logger("database")
    assert logger.name == "nesh.database"
