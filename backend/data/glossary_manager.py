"""
Glossary manager with optional JSON loading.

The app imports this module during startup. If the glossary file is missing,
the manager stays empty and the API continues to work.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, Optional


class GlossaryManager:
    def __init__(self) -> None:
        self._terms: Dict[str, Dict[str, Any]] = {}
        self._regex: Optional[re.Pattern[str]] = None

    def _build_regex(self) -> None:
        if not self._terms:
            self._regex = None
            return

        # Longest-first avoids partial matching when terms overlap.
        escaped_terms = sorted((re.escape(t) for t in self._terms.keys()), key=len, reverse=True)
        self._regex = re.compile(r"\b(" + "|".join(escaped_terms) + r")\b", re.IGNORECASE)

    def load_from_json(self, path: str) -> bool:
        if not os.path.exists(path):
            self._terms = {}
            self._regex = None
            return False

        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)

        terms: Dict[str, Dict[str, Any]] = {}
        if isinstance(raw, dict):
            iterable = raw.items()
        elif isinstance(raw, list):
            iterable = ((str(item.get("term", "")), item) for item in raw if isinstance(item, dict))
        else:
            iterable = ()

        for key, value in iterable:
            term = str(key).strip().lower()
            if not term:
                continue
            if isinstance(value, dict):
                terms[term] = value
            else:
                terms[term] = {"definition": str(value)}

        self._terms = terms
        self._build_regex()
        return True

    def get_definition(self, term: str) -> Optional[Dict[str, Any]]:
        if not term:
            return None
        return self._terms.get(term.strip().lower())

    def get_regex_pattern(self) -> Optional[re.Pattern[str]]:
        return self._regex


glossary_manager = GlossaryManager()


def init_glossary(project_root: str) -> None:
    # Keep compatibility with old and new layouts.
    candidates = [
        os.path.join(project_root, "backend", "data", "glossary_db.json"),
        os.path.join(project_root, "data", "glossary_db.json"),
    ]
    for path in candidates:
        if glossary_manager.load_from_json(path):
            return

