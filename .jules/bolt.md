## 2024-04-18 - Safe Caching for Word Stemming
**Learning:** In Python, wrapping an instance method with `@lru_cache` can lead to memory leaks across multiple instances because `self` is implicitly included in the cache key.
**Action:** When caching word processing logic (like NLP stemming), always use bounded `@functools.lru_cache` on `@staticmethod`s or module-level functions to allow caching words safely across queries and documents.
