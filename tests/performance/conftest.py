import os
import subprocess
import sys
import time

import pytest


@pytest.fixture(scope="session")
def nesh_service():
    """Instancia DatabaseAdapter/NeshService in-process (warm benchmarks)."""
    from backend.config import CONFIG
    from backend.data.glossary_manager import init_glossary
    from backend.infrastructure.database import DatabaseAdapter
    from backend.services.nesh_service import NeshService

    project_root = os.getcwd()
    init_glossary(project_root)

    db = DatabaseAdapter(CONFIG.db_path)
    svc = NeshService(db)
    return svc


@pytest.fixture(scope="session")
def tipi_service():
    from backend.services.tipi_service import TipiService

    return TipiService()


@pytest.fixture(scope="session")
def cold_start_measure():
    """Mede cold start sem depender de HTTP (lê stdout do processo até 'Servidor ... iniciado')."""

    def _measure(timeout_s: float = 60.0) -> float:
        env = os.environ.copy()
        env["NESH_NO_BROWSER"] = "1"
        env["PYTHONUNBUFFERED"] = "1"

        start = time.perf_counter()
        proc = subprocess.Popen(
            [sys.executable, "-u", "Nesh.py"],
            cwd=os.getcwd(),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )

        output_lines: list[str] = []

        try:
            deadline = time.time() + timeout_s
            while time.time() < deadline:
                line = proc.stdout.readline() if proc.stdout else ""
                if not line:
                    # Processo morreu cedo?
                    if proc.poll() is not None:
                        tail = "".join(output_lines[-30:])
                        raise RuntimeError(
                            f"Servidor encerrou durante cold start (exit={proc.returncode}).\n--- stdout tail ---\n{tail}"
                        )
                    continue

                output_lines.append(line)

                # Check for either our custom print or Uvicorn's standard startup message
                if ("Starting Nesh Server" in line) or ("Application startup complete" in line) or ("Uvicorn running on" in line):
                    return (time.perf_counter() - start) * 1000.0

                if "Banco de dados não encontrado" in line or "DB_NOT_FOUND" in line:
                    raise RuntimeError(line.strip())

            raise RuntimeError(f"Timeout cold start ({timeout_s}s)")
        finally:
            try:
                proc.terminate()
            except Exception:  # noqa: BLE001
                pass
            try:
                proc.wait(timeout=5)
            except Exception:  # noqa: BLE001
                pass

    return _measure
