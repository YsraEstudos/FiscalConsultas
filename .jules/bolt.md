## 2024-05-18 - [Add lru_cache to Stemmer]
**Learning:** Bounded `@functools.lru_cache` on a module-level function is more efficient than local method-scoped memoization because it caches words across multiple documents and queries, and using lru_cache directly on an instance method has a side effect where `self` is part of the cache key which causes cache misses across instances and potential memory leaks.
**Action:** Apply `lru_cache` at module-level and use it within the stemmer class to ensure maximum reuse across the process without leaking instances.
