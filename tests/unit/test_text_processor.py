import pytest
from backend.utils import text_processor
from backend.utils.text_processor import NeshTextProcessor, PortugueseStemmer

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def clear_stem_cache_between_tests():
    text_processor._cached_stem.cache_clear()
    yield
    text_processor._cached_stem.cache_clear()


def test_stemmer_plural_rules_cover_specific_suffixes():
    s = PortugueseStemmer()
    assert s.step_plural("trens") == "trem"  # ns -> m
    assert s.step_plural("animais") == "animal"  # ais -> al
    assert s.step_plural("papeis") == "papel"  # eis -> el
    assert s.step_plural("lencois") == "lencol"  # ois -> ol
    assert s.step_plural("funis") == "funil"  # is -> il
    assert s.step_plural("males") == "mal"  # les -> l
    assert s.step_plural("motores") == "motor"  # res -> trim 2
    assert s.step_plural("luzes") == "luz"  # es with s/z/r rule
    assert s.step_plural("paredes") == "parede"  # generic es -> e
    assert s.step_plural("carros") == "carro"  # generic s


def test_stemmer_feminine_rules():
    s = PortugueseStemmer()
    assert s.step_feminine("pequena") == "pequeno"
    assert s.step_feminine("produtora") == "produtor"
    assert s.step_feminine("gata") == "gat"
    assert s.step_feminine("mar") == "mar"


def test_stem_normalizes_case_and_accent():
    s = PortugueseStemmer()
    assert s.stem("MÁQUINAS") == "maquino"


def test_processor_normalize_and_process_with_stopwords():
    p = NeshTextProcessor(stopwords=["de", "com"])
    text = "Máquinas de lavar, com motor elétrico!"
    assert p.normalize(text) == "maquinas de lavar, com motor eletrico!"
    assert p.process(text) == "maquino lavar motor eletrico"


@pytest.mark.parametrize(
    (
        "text",
        "stopwords",
        "expected_normalized",
        "expected_process",
        "expected_fts",
        "expected_exact",
    ),
    [
        (
            "Máquinas de lavar, com motor elétrico!",
            ["de", "com"],
            "maquinas de lavar, com motor eletrico!",
            "maquino lavar motor eletrico",
            "maquino* lavar* motor* eletrico*",
            "maquino lavar motor eletrico",
        ),
        (
            "Motores, luzes e papéis para trens",
            ["e", "para"],
            "motores, luzes e papeis para trens",
            "motor luz papel trem",
            "motor* luz* papel* trem*",
            "motor luz papel trem",
        ),
        (
            "A produtora pequena vende carros nacionais",
            ["a"],
            "a produtora pequena vende carros nacionais",
            "produtor pequeno vende carro nacional",
            "produtor* pequeno* vende* carro* nacional*",
            "produtor pequeno vende carro nacional",
        ),
    ],
)
def test_processor_outputs_stay_unchanged_with_stem_cache(
    text,
    stopwords,
    expected_normalized,
    expected_process,
    expected_fts,
    expected_exact,
):
    processor = NeshTextProcessor(stopwords=stopwords)

    assert processor.normalize(text) == expected_normalized
    assert processor.process(text) == expected_process
    assert processor.process_query_for_fts(text) == expected_fts
    assert processor.process_query_exact(text) == expected_exact


def test_process_ignores_single_letters_and_stopwords():
    p = NeshTextProcessor(stopwords=["a"])
    assert p.process("a b c de") == "de"


def test_process_query_for_fts_appends_wildcards():
    p = NeshTextProcessor(stopwords=["de"])
    assert p.process_query_for_fts("Motores de arranque") == "motor* arranque*"


def test_process_query_exact_without_wildcards():
    p = NeshTextProcessor(stopwords=["de"])
    assert p.process_query_exact("Motores de arranque") == "motor arranque"


def test_processor_reuses_cached_stems_for_repeated_words(monkeypatch):
    calls = []

    def fake_stem(word):
        calls.append(word)
        return f"{word}-stemmed"

    monkeypatch.setattr(text_processor._SHARED_STEMMER, "stem", fake_stem)

    processor = NeshTextProcessor()

    assert processor.process("motores motores luzes motores") == (
        "motores-stemmed motores-stemmed luzes-stemmed motores-stemmed"
    )
    assert calls == ["motores", "luzes"]
    assert text_processor._cached_stem.cache_info().hits == 2
    assert text_processor._cached_stem.cache_info().misses == 2


def test_step_augmentative_is_noop():
    s = PortugueseStemmer()
    assert s.step_augmentative("carrinho") == "carrinho"


def test_replace_suffix_returns_original_when_suffix_not_present():
    s = PortugueseStemmer()
    assert s._replace_suffix("motor", "xyz", "a") == "motor"
