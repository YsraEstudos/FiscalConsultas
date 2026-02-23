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


def test_setup_logging_adds_file_handler_when_log_file_provided(tmp_path, monkeypatch):
    _clear_nesh_handlers()
    monkeypatch.setattr(logging_config.sys, "platform", "linux", raising=False)
    log_file = tmp_path / "nesh.log"

    logging_config.setup_logging(log_file=str(log_file))
    logger = logging.getLogger("nesh")
    assert any(isinstance(h, logging.FileHandler) for h in logger.handlers)
    _clear_nesh_handlers()


def test_get_logger_uses_nesh_prefix():
    logger = logging_config.get_logger("database")
    assert logger.name == "nesh.database"
