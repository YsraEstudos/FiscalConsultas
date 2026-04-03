## 2025-02-28 - Optimizing NLP Text Processors
**Learning:** In Python, applying `@functools.lru_cache` to a class instance method caches the `self` instance itself as part of the key. This causes unnecessary overhead, possible memory leaks, and misses the cache across multiple distinct class instances handling the same text values.
**Action:** Always convert pure text-processing logic methods inside utility classes (like stemmers or normalizers) into `@staticmethod`s *before* wrapping them in `@functools.lru_cache`. This enables efficient global memoization of repetitive strings.
