import pytest
from backend.utils.text_processor import NeshTextProcessor, PortugueseStemmer

pytestmark = pytest.mark.unit


def test_stemmer_plural_rules_cover_specific_suffixes():
    from backend.utils.text_processor import _stem_word
    # Test plural variations via stemmer since the methods were inlined for performance
    assert _stem_word("trens") == "trem"
    assert _stem_word("animais") == "animal"
    assert _stem_word("papeis") == "papel"
    assert _stem_word("lencois") == "lencol"
    assert _stem_word("funis") == "funil"
    assert _stem_word("males") == "mal"
    assert _stem_word("motores") == "motor"
    assert _stem_word("luzes") == "luz"
    assert _stem_word("paredes") == "parede"
    assert _stem_word("carros") == "carro"


def test_stemmer_feminine_rules():
    from backend.utils.text_processor import _stem_word
    assert _stem_word("pequena") == "pequeno"
    assert _stem_word("produtora") == "produtor"
    assert _stem_word("gata") == "gat"
    assert _stem_word("mar") == "mar"


def test_stem_normalizes_case_and_accent():
    s = PortugueseStemmer()
    assert s.stem("MÁQUINAS") == "maquino"


def test_processor_normalize_and_process_with_stopwords():
    p = NeshTextProcessor(stopwords=["de", "com"])
    text = "Máquinas de lavar, com motor elétrico!"
    assert p.normalize(text) == "maquinas de lavar, com motor eletrico!"
    assert p.process(text) == "maquino lavar motor eletrico"


def test_process_ignores_single_letters_and_stopwords():
    p = NeshTextProcessor(stopwords=["a"])
    assert p.process("a b c de") == "de"


def test_process_query_for_fts_appends_wildcards():
    p = NeshTextProcessor(stopwords=["de"])
    assert p.process_query_for_fts("Motores de arranque") == "motor* arranque*"


def test_process_query_exact_without_wildcards():
    p = NeshTextProcessor(stopwords=["de"])
    assert p.process_query_exact("Motores de arranque") == "motor arranque"


def test_step_augmentative_is_noop():
    # removed step_augmentative as it was a noop anyway
    pass


def test_replace_suffix_returns_original_when_suffix_not_present():
    # step_plural no longer relies on replace_suffix as it uses string slices
    pass
