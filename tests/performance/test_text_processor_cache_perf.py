import pytest

from backend.utils import text_processor
from backend.utils.text_processor import NeshTextProcessor

pytestmark = pytest.mark.perf


def test_text_processor_cache_benchmark(benchmark):
    text_processor._cached_stem.cache_clear()
    processor = NeshTextProcessor(stopwords=["de", "com", "para"])
    text = " ".join(
        [
            "motores",
            "motores",
            "máquinas",
            "máquinas",
            "luzes",
            "papéis",
            "trens",
            "produtora",
            "pequena",
            "carros",
        ]
        * 200
    )

    result = benchmark(processor.process, text)

    assert "motor" in result
    assert "maquino" in result
    assert text_processor._cached_stem.cache_info().hits > 0
