import re
import unicodedata
import functools
from typing import List

# Pre-compiled regex for word extraction (performance optimization)
_RE_WORD = re.compile(r"\b\w+\b")


@functools.lru_cache(maxsize=10240)
def _stem_word(word: str) -> str:
    """
    Stemming logic memoized for performance.
    Moved out of the class so caching doesn't capture the `self` instance.
    """
    word = word.lower()

    # Remove accents
    word = (
        unicodedata.normalize("NFKD", word)
        .encode("ASCII", "ignore")
        .decode("utf-8")
    )

    # Plural step
    if word.endswith("s"):
        if word.endswith("ns"):  # ex: trens -> trem
            word = word[:-2] + "m"
        elif word.endswith("ais"):  # animais -> animal
            word = word[:-3] + "al"
        elif word.endswith("eis"):  # papeis -> papel, submersiveis -> submersivel
            word = word[:-3] + "el"
        elif word.endswith("ois"):  # lencois -> lencol
            word = word[:-3] + "ol"
        elif word.endswith("is"):  # funis -> funil
            word = word[:-2] + "il"
        elif word.endswith("les"):  # males -> mal
            word = word[:-3] + "l"
        elif word.endswith("res"):  # motores -> motor
            word = word[:-2]
        elif word.endswith("es"):  # ex: motores -> motor
            if len(word) >= 4 and word[-3] in "szr":
                word = word[:-2]
            else:
                word = word[:-2] + "e"
        else:
            word = word[:-1]  # carros -> carro

    # Feminine step
    if word.endswith("a"):
        if word.endswith("na"):  # pequena -> pequeno
            word = word[:-1] + "o"
        elif word.endswith("ra"):  # produtora -> produtor
            word = word[:-1]
        elif len(word) > 3:
            word = word[:-1]  # gata -> gat

    return word


class PortugueseStemmer:
    """
    Stemmer simplificado para o Português, focado no contexto de NCMs.
    Baseado livremente em regras do RSLP (Removedor de Sufixos da Língua Portuguesa).
    """

    def _remove_accent(self, word: str) -> str:
        return (
            unicodedata.normalize("NFKD", word)
            .encode("ASCII", "ignore")
            .decode("utf-8")
        )

    def stem(self, word: str) -> str:
        return _stem_word(word)


class NeshTextProcessor:
    """Fachada para processamento de texto no Nesh."""

    def __init__(self, stopwords: List[str] = None):
        self.stemmer = PortugueseStemmer()
        self.stopwords = set(stopwords) if stopwords else set()

    def normalize(self, text: str) -> str:
        """Remove acentos e minúsculas."""
        text = self.stemmer._remove_accent(text.lower())
        return text

    def process(self, text: str) -> str:
        """Normaliza, remove stopwords e aplica stemming."""
        normalized = self.normalize(text)
        words = _RE_WORD.findall(normalized)

        return " ".join(
            _stem_word(w)
            for w in words
            if w not in self.stopwords and len(w) >= 2
        )

    def process_query_for_fts(self, text: str) -> str:
        """Prepara string para FTS (prefix search com wildcards)."""
        normalized = self.normalize(text)
        words = _RE_WORD.findall(normalized)

        return " ".join(
            f"{_stem_word(w)}*"
            for w in words
            if w not in self.stopwords
        )

    def process_query_exact(self, text: str) -> str:
        """Prepara string para FTS SEM wildcards (busca exata)."""
        normalized = self.normalize(text)
        words = _RE_WORD.findall(normalized)

        return " ".join(
            _stem_word(w)
            for w in words
            if w not in self.stopwords
        )
