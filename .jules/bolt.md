## 2024-04-29 - [Bounded LRU Cache for Stemmer]
**Learning:** Instantiating `PortugueseStemmer` inside the `NeshTextProcessor` facade and directly calling its `stem` method causes redundant CPU-intensive text normalizations for the same words, particularly across large datasets or repetitive FTS queries where the vocabulary is bounded. Applying `@functools.lru_cache` to a module-level proxy function significantly speeds up NLP stemming. Never apply `lru_cache` directly to an instance method.
**Action:** Always use a module-level bounded `lru_cache` on a decoupled proxy function when caching results from an instance method (e.g., stemming) across multiple instances to avoid including `self` in the cache key and causing cache misses or memory leaks.

## 2024-05-09 - [Python String Processing]
**Learning:** `"".join(filter(str.isdigit, s))` is 2-3x faster than `re.sub(r"[^0-9]", "", s)`. `"".join(s.split())` is ~5x faster than `re.sub(r"\s+", "", s)`.
**Action:** Use native Python string methods instead of regular expressions for simple string filtering and whitespace removal.
