## 2024-04-29 - [Bounded LRU Cache for Stemmer]
**Learning:** Instantiating `PortugueseStemmer` inside the `NeshTextProcessor` facade and directly calling its `stem` method causes redundant CPU-intensive text normalizations for the same words, particularly across large datasets or repetitive FTS queries where the vocabulary is bounded. Applying `@functools.lru_cache` to a module-level proxy function significantly speeds up NLP stemming. Never apply `lru_cache` directly to an instance method.
**Action:** Always use a module-level bounded `lru_cache` on a decoupled proxy function when caching results from an instance method (e.g., stemming) across multiple instances to avoid including `self` in the cache key and causing cache misses or memory leaks.

## 2024-05-14 - [Fast String Splitting and Cleaning]
**Learning:** Chaining `.replace()` followed by `.split()` is significantly faster than `re.split()` for multiple delimiters like commas and semicolons. Also `"".join(s.split())` is faster than `re.sub(r"\s+", "", s)` for whitespace removal.
**Action:** Use string methods over regex for simple character replacements, whitespace removal, and splitting by fixed delimiters to improve performance.
