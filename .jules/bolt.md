## 2024-05-18 - Caching Stemmer Methods
**Learning:** In text processing applications where the same words are repeatedly processed (e.g., NLP stemming for NCMs), applying an `lru_cache` to instance methods leads to suboptimal cache hits because `self` is part of the cache key.
**Action:** Always convert state-independent processing methods to `@staticmethod` before applying `@lru_cache`. This ensures the cache key is solely based on the input text, drastically improving hit rates across different instances and documents without risking memory leaks from bound instances.
