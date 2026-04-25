## 2024-05-24 - Optimizing PortugueseStemmer via Static lru_cache
**Learning:** The NLP stemmer calculation can be heavily optimized by caching results. However, applying `@lru_cache` directly to instance methods caches the `self` object alongside the word, causing cache misses across different instances and potential memory leaks.
**Action:** Used a `@staticmethod` with `@lru_cache` within the stemmer, allowing cross-instance reuse of cached stem operations.
