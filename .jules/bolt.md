## 2024-05-24 - [LRU Cache for Stemming NLP]
**Learning:** Bounded `@functools.lru_cache` on a module-level word stemmer function is much more efficient than executing regex string replacement logic over and over in instances, achieving almost 5x speedup in NeshTextProcessor text processing performance. Local method-scoped memoization should be avoided to prevent cache misses across instances and potential memory leaks.
**Action:** Always extract and apply `lru_cache` to independent pure functions outside of class instantiations.
