import pytest

from backend.utils.id_utils import generate_anchor_id

pytestmark = pytest.mark.unit


def test_generate_anchor_id_formats_normal_code() -> None:
    assert generate_anchor_id("85.17") == "pos-85-17"


def test_generate_anchor_id_strips_spaces_and_unsafe_characters() -> None:
    assert generate_anchor_id(" 85.17<script> ") == "pos-85-17script"


def test_generate_anchor_id_returns_empty_string_for_blank_input() -> None:
    assert generate_anchor_id("") == ""
