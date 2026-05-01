import functools
import re
import unicodedata
from typing import List

# Pre-compiled regex for word extraction (performance optimization)
_RE_WORD = re.compile(r"\b\w+\b")


@functools.lru_cache(maxsize=1024)
def _remove_accent(word: str) -> str:
    return unicodedata.normalize("NFKD", word).encode("ASCII", "ignore").decode("utf-8")


@functools.lru_cache(maxsize=1024)
def _replace_suffix(word: str, suffix: str, replacement: str) -> str:
    if word.endswith(suffix):
        return word[: -len(suffix)] + replacement
    return word


@functools.lru_cache(maxsize=1024)
def _step_plural(word: str) -> str:
    """Remove sufixos de plural."""
    if word.endswith("s"):
        if word.endswith("ns"):  # ex: trens -> trem
            return _replace_suffix(word, "ns", "m")
        # IMPORTANTE: Verificar sufixos mais específicos ANTES do genérico 'es'
        elif word.endswith("ais"):  # animais -> animal
            return _replace_suffix(word, "ais", "al")
        elif word.endswith("eis"):  # papeis -> papel, submersiveis -> submersivel
            return _replace_suffix(word, "eis", "el")
        elif word.endswith("ois"):  # lencois -> lencol
            return _replace_suffix(word, "ois", "ol")
        elif word.endswith("is"):  # funis -> funil
            return _replace_suffix(word, "is", "il")
        elif word.endswith("les"):  # males -> mal
            return _replace_suffix(word, "les", "l")
        elif word.endswith("res"):  # motores -> motor
            return word[:-2]
        elif word.endswith(
            "es"
        ):  # ex: motores -> motor (AGORA DEPOIS dos específicos!)
            if (
                len(word) >= 4 and word[-3] in "szr"
            ):  # luzes->luz, vezes->vez, cores->cor
                return word[:-2]
            return _replace_suffix(word, "es", "e")
        else:
            return word[:-1]  # carros -> carro
    return word


@functools.lru_cache(maxsize=1024)
def _step_feminine(word: str) -> str:
    """Redução de feminino para masculino (aproximado)."""
    if word.endswith("a"):
        if word.endswith("na"):  # pequena -> pequeno
            return _replace_suffix(word, "a", "o")
        if word.endswith("ra"):  # produtora -> produtor
            return word[:-1]
        if len(word) > 3:
            return word[:-1]  # gata -> gat
    return word


@functools.lru_cache(maxsize=4096)
def _stem(word: str) -> str:
    word = word.lower()
    word = _remove_accent(word)

    # Ordem de aplicação
    word = _step_plural(word)
    word = _step_feminine(word)

    return word


class PortugueseStemmer:
    """
    Stemmer simplificado para o Português, focado no contexto de NCMs.
    Baseado livremente em regras do RSLP (Removedor de Sufixos da Língua Portuguesa).
    """

    def _remove_accent(self, word: str) -> str:
        return _remove_accent(word)

    def _replace_suffix(self, word: str, suffix: str, replacement: str) -> str:
        return _replace_suffix(word, suffix, replacement)

    def step_plural(self, word: str) -> str:
        """Remove sufixos de plural."""
        return _step_plural(word)

    def step_feminine(self, word: str) -> str:
        """Redução de feminino para masculino (aproximado)."""
        return _step_feminine(word)

    def step_augmentative(self, word: str) -> str:
        # NCMs usam pouco aumentativo, mas...
        return word

    def stem(self, word: str) -> str:
        return _stem(word)


class NeshTextProcessor:
    """Fachada para processamento de texto no Nesh."""

    def __init__(self, stopwords: List[str] = None):
        self.stemmer = PortugueseStemmer()
        self.stopwords = set(stopwords) if stopwords else set()

    def normalize(self, text: str) -> str:
        """Remove acentos e minúsculas."""
        text = _remove_accent(text.lower())
        return text

    def process(self, text: str) -> str:
        """Normaliza, remove stopwords e aplica stemming."""
        normalized = self.normalize(text)
        words = _RE_WORD.findall(normalized)

        processed = []
        for w in words:
            if w in self.stopwords:
                continue
            if len(w) < 2:  # Ignora letras soltas
                continue

            stemmed = self.stemmer.stem(w)
            processed.append(stemmed)

        return " ".join(processed)

    def process_query_for_fts(self, text: str) -> str:
        """Prepara string para FTS (prefix search com wildcards)."""
        normalized = self.normalize(text)
        words = _RE_WORD.findall(normalized)

        processed = []
        for w in words:
            if w in self.stopwords:
                continue

            stemmed = self.stemmer.stem(w)
            processed.append(f"{stemmed}*")

        return " ".join(processed)

    def process_query_exact(self, text: str) -> str:
        """Prepara string para FTS SEM wildcards (busca exata)."""
        normalized = self.normalize(text)
        words = _RE_WORD.findall(normalized)

        processed = []
        for w in words:
            if w in self.stopwords:
                continue

            stemmed = self.stemmer.stem(w)
            processed.append(stemmed)

        return " ".join(processed)
