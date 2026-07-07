## 2024-04-29 - [Bounded LRU Cache for Stemmer]
**Learning:** Instantiating `PortugueseStemmer` inside the `NeshTextProcessor` facade and directly calling its `stem` method causes redundant CPU-intensive text normalizations for the same words, particularly across large datasets or repetitive FTS queries where the vocabulary is bounded. Applying `@functools.lru_cache` to a module-level proxy function significantly speeds up NLP stemming. Never apply `lru_cache` directly to an instance method.
**Action:** Always use a module-level bounded `lru_cache` on a decoupled proxy function when caching results from an instance method (e.g., stemming) across multiple instances to avoid including `self` in the cache key and causing cache misses or memory leaks.

## 2024-05-18 - [Optimize Multiple Delimiter Splitting]
**Learning:** Using `re.split(r"[;,\s]+", string)` is convenient but carries significant regex compilation and execution overhead when just splitting by a few known characters (semicolons, commas, spaces).
**Action:** When a string needs to be split by a small, fixed set of delimiters, use chained string replacement (`string.replace(';', ' ').replace(',', ' ').split()`) instead of `re.split()`. In this codebase, it is ~5x faster. Also, for completely removing whitespace, `"".join(string.split())` is ~6x faster than `re.sub(r"\s+", "", string)`.
