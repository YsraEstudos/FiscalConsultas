## 2024-04-09 - [NLP Stemming Optimization]
**Learning:** In text processing utilities (like `PortugueseStemmer`), applying `@functools.lru_cache` to instance methods can lead to suboptimal cache hit rates and memory leaks because the `self` parameter is included in the cache key.
**Action:** Always refactor purely functional algorithms within classes to `@staticmethod` before applying memoization like `lru_cache`, to ensure optimal cache reuse across queries and avoid memory bounds issues.
