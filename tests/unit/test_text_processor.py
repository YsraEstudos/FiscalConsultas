import pytest
from backend.utils.text_processor import NeshTextProcessor, PortugueseStemmer

pytestmark = pytest.mark.unit


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


def test_cached_processor_matches_direct_stemmer_for_common_words():
    import backend.utils.text_processor as text_processor

    text_processor._cached_stem.cache_clear()

    try:
        processor = text_processor.NeshTextProcessor()
        stemmer = text_processor.PortugueseStemmer()

        words = [
            "Máquinas",
            "motores",
            "animais",
            "luzes",
            "produtora",
            "arranque",
            "elétrico",
        ]

        for word in words:
            normalized = processor.normalize(word)
            assert processor.process(word) == stemmer.stem(normalized)
    finally:
        text_processor._cached_stem.cache_clear()


def test_cached_stem_reuses_result_across_processor_instances(monkeypatch):
    import backend.utils.text_processor as text_processor

    text_processor._cached_stem.cache_clear()

    try:
        calls = {"count": 0}
        original_stem = text_processor._SHARED_STEMMER.stem

        def counting_stem(word: str) -> str:
            calls["count"] += 1
            return original_stem(word)

        monkeypatch.setattr(text_processor._SHARED_STEMMER, "stem", counting_stem)

        processor_1 = text_processor.NeshTextProcessor()
        processor_2 = text_processor.NeshTextProcessor()

        assert processor_1.process("Motores motores") == "motor motor"
        assert processor_2.process("motores") == "motor"

        assert calls["count"] == 1
    finally:
        text_processor._cached_stem.cache_clear()


def test_cached_stem_keeps_query_outputs_unchanged():
    import backend.utils.text_processor as text_processor

    text_processor._cached_stem.cache_clear()

    try:
        processor = text_processor.NeshTextProcessor(stopwords=["de", "com"])

        assert processor.process("Máquinas de lavar, com motor elétrico!") == (
            "maquino lavar motor eletrico"
        )
        assert processor.process_query_for_fts("Motores de arranque") == (
            "motor* arranque*"
        )
        assert processor.process_query_exact("Motores de arranque") == "motor arranque"
    finally:
        text_processor._cached_stem.cache_clear()


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
    s = PortugueseStemmer()
    assert s.step_augmentative("carrinho") == "carrinho"


def test_replace_suffix_returns_original_when_suffix_not_present():
    s = PortugueseStemmer()
    assert s._replace_suffix("motor", "xyz", "a") == "motor"
