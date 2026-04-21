from __future__ import annotations

import ast
import json
from pathlib import Path
import tempfile
import textwrap

import pytest

import scripts.report_long_functions as long_functions

pytestmark = pytest.mark.unit


def test_count_function_body_lines_ignores_blank_lines_and_comments_but_counts_docstrings():
    source = textwrap.dedent(
        '''
        def sample():
            """Line 1
            # not a comment
            Line 3
            """
            value = 1

            # comment
            return value
        '''
    )

    module = ast.parse(source)
    function_node = module.body[0]

    assert long_functions.count_function_body_lines(source, function_node) == 6


def test_scan_tree_reports_only_module_level_functions_and_skips_generated_dirs():
    with tempfile.TemporaryDirectory(dir=Path.cwd()) as temp_dir:
        project_root = Path(temp_dir) / "project"
        project_root.mkdir()

        source = textwrap.dedent(
            '''
            def short_function():
                return 1

            def long_function():
                alpha = 1
                # comment
                beta = 2

                gamma = 3
                return alpha + beta + gamma

            @decorator
            def decorated_function():
                first = 1
                second = 2
                return first + second

            class Example:
                def method(self):
                    value = 1
                    value += 2
                    return value
            '''
        )
        (project_root / "module.py").write_text(source, encoding="utf-8")

        ignored_root = project_root / ".venv"
        ignored_root.mkdir()
        (ignored_root / "ignored.py").write_text(
            "def ignored():\n    x = 1\n    y = 2\n    return x + y\n",
            encoding="utf-8",
        )

        report = long_functions.scan_tree(project_root, threshold=2)

        assert [finding.function_name for finding in report.findings] == [
            "long_function",
            "decorated_function",
        ]
        assert all(
            "ignored.py" not in finding.relative_path for finding in report.findings
        )
        assert all(finding.function_name != "method" for finding in report.findings)


def test_write_json_report_exports_root_object_keyed_by_item_ids():
    with tempfile.TemporaryDirectory(dir=Path.cwd()) as temp_dir:
        temp_root = Path(temp_dir)
        project_root = temp_root / "project"
        project_root.mkdir()

        source = textwrap.dedent(
            '''
            def first():
                a = 1
                b = 2
                return a + b

            def second():
                value = 1
                value += 2
                value += 3
                return value
            '''
        )
        (project_root / "module.py").write_text(source, encoding="utf-8")

        report = long_functions.scan_tree(project_root, threshold=2)
        output_path = temp_root / "report.json"

        long_functions.write_json_report(report, output_path)

        payload = json.loads(output_path.read_text(encoding="utf-8"))

        assert payload["summary"]["matched_functions"] == 2
        assert payload["summary"]["threshold"] == 2
        assert payload["ITEM_0001"]["function_name"] == "second"
        assert payload["ITEM_0002"]["function_name"] == "first"