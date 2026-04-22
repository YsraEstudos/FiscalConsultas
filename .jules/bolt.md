## 2025-05-18 - Stemmer memoization instance method capture
**Learning:** Applying `@functools.lru_cache` to a class instance method (e.g., `stem(self, word)`) causes `self` to be part of the cache key, reducing hit rate across instances and potentially creating a memory leak.
**Action:** Extract the method to a module-level function `_stem_word(word)` and decorate it there, then call it from the class instance method.
