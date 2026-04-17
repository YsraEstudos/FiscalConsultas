## 2026-04-17 - Optimize word stemming cache lookup

**Learning:** When using `@functools.lru_cache` to optimize pure functions like NLP stemming across instances, it must be applied to `@staticmethod` or module-level functions. If applied directly to an instance method, `self` is included in the cache key, which leads to cache misses when different instances are created and could cause memory leaks.

**Action:** Ensure memoization of word processors (which are pure functions based only on the string input) uses static methods to share the cache across all queries and documents.
