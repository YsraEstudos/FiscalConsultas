import pytest
from backend.utils.text_processor import (
    NeshTextProcessor,
    PortugueseStemmer,
    _step_plural,
    _step_feminine,
    _replace_suffix,
)

pytestmark = pytest.mark.unit


def test_stemmer_plural_rules_cover_specific_suffixes():
    assert _step_plural("trens") == "trem"  # ns -> m
    assert _step_plural("animais") == "animal"  # ais -> al
    assert _step_plural("papeis") == "papel"  # eis -> el
    assert _step_plural("lencois") == "lencol"  # ois -> ol
    assert _step_plural("funis") == "funil"  # is -> il
    assert _step_plural("males") == "mal"  # les -> l
    assert _step_plural("motores") == "motor"  # res -> trim 2
    assert _step_plural("luzes") == "luz"  # es with s/z/r rule
    assert _step_plural("paredes") == "parede"  # generic es -> e
    assert _step_plural("carros") == "carro"  # generic s


def test_stemmer_feminine_rules():
    assert _step_feminine("pequena") == "pequeno"
    assert _step_feminine("produtora") == "produtor"
    assert _step_feminine("gata") == "gat"
    assert _step_feminine("mar") == "mar"


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


def test_replace_suffix_returns_original_when_suffix_not_present():
    assert _replace_suffix("motor", "xyz", "a") == "motor"
