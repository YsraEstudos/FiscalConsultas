## 2024-05-18 - Module-level Caching for NLP Stemming
**Learning:** Applying `@functools.lru_cache` to a class instance method (e.g., `stem(self, word)`) includes `self` in the cache key. This causes cache misses across different instances and potential memory leaks as it holds strong references to the instances.
**Action:** Always extract memoized word-processing functions (like NLP stemming) to module-level functions or `@staticmethod` to ensure cache hits across all invocations and prevent memory leaks.
