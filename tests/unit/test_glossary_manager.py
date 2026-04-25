from __future__ import annotations

import json
import os

import pytest

from backend.data.glossary_manager import (
    GlossaryManager,
    glossary_manager,
    init_glossary,
)

pytestmark = pytest.mark.unit


def test_load_from_json_returns_false_for_missing_file(tmp_path) -> None:
    manager = GlossaryManager()
    missing_path = tmp_path / "missing.json"

    assert manager.load_from_json(str(missing_path)) is False
    assert manager.get_regex_pattern() is None
    assert manager.get_definition("motor") is None


def test_load_from_json_accepts_dict_payload_and_builds_longest_first_regex(
    tmp_path,
) -> None:
    path = tmp_path / "glossary.json"
    path.write_text(
        json.dumps(
            {
                "motor": "dispositivo",
                "motor elétrico": {"definition": "variante"},
            }
        ),
        encoding="utf-8",
    )

    manager = GlossaryManager()
    assert manager.load_from_json(str(path)) is True
    assert manager.get_definition("MOTOR") == {"definition": "dispositivo"}

    pattern = manager.get_regex_pattern()
    assert pattern is not None
    match = pattern.search("motor elétrico e motor")
    assert match is not None
    assert match.group(1).lower() == "motor elétrico"


def test_load_from_json_handles_scalar_payload_and_empty_regex(tmp_path) -> None:
    path = tmp_path / "glossary_scalar.json"
    path.write_text("42", encoding="utf-8")

    manager = GlossaryManager()
    assert manager.load_from_json(str(path)) is True
    assert manager.get_definition("anything") is None
    assert manager.get_regex_pattern() is None


def test_build_regex_resets_pattern_when_terms_are_empty() -> None:
    manager = GlossaryManager()
    manager._build_regex()
    assert manager.get_regex_pattern() is None


def test_load_from_json_accepts_list_payload_and_ignores_invalid_entries(
    tmp_path,
) -> None:
    path = tmp_path / "glossary_list.json"
    path.write_text(
        json.dumps(
            [
                {"term": "bomba", "definition": "equipamento"},
                {"term": "válvula", "definition": "controle"},
                "ignored",
            ]
        ),
        encoding="utf-8",
    )

    manager = GlossaryManager()
    assert manager.load_from_json(str(path)) is True
    assert manager.get_definition("bomba") == {
        "term": "bomba",
        "definition": "equipamento",
    }
    assert manager.get_definition("válvula") == {
        "term": "válvula",
        "definition": "controle",
    }
    assert manager.get_definition("") is None


def test_init_glossary_tries_backend_then_data_locations(monkeypatch) -> None:
    calls: list[str] = []

    def fake_load_from_json(path: str) -> bool:
        calls.append(path)
        return (
            path.endswith(os.path.join("data", "glossary_db.json"))
            and "backend" not in path
        )

    monkeypatch.setattr(glossary_manager, "load_from_json", fake_load_from_json)

    init_glossary(r"C:\project-root")

    assert calls == [
        os.path.join(r"C:\project-root", "backend", "data", "glossary_db.json"),
        os.path.join(r"C:\project-root", "data", "glossary_db.json"),
    ]
