## 2024-04-29 - [Bounded LRU Cache for Stemmer]
**Learning:** Instantiating `PortugueseStemmer` inside the `NeshTextProcessor` facade and directly calling its `stem` method causes redundant CPU-intensive text normalizations for the same words, particularly across large datasets or repetitive FTS queries where the vocabulary is bounded. Applying `@functools.lru_cache` to a module-level proxy function significantly speeds up NLP stemming. Never apply `lru_cache` directly to an instance method.
**Action:** Always use a module-level bounded `lru_cache` on a decoupled proxy function when caching results from an instance method (e.g., stemming) across multiple instances to avoid including `self` in the cache key and causing cache misses or memory leaks.

## 2024-05-18 - [Optimizing String Delimiters and Cleanups]
**Learning:** Using chained `.replace()` calls followed by `.split()` is significantly faster than `re.split()` for splitting strings by multiple specific delimiters. Also, for strictly stripping non-numeric characters, a generator comprehension with `c in "0123456789"` outperforms regex `re.sub()` and is safer than `str.isdigit()`.
**Action:** Always favor chained string methods over regex for simple multi-delimiter splits, and use explicitly bounded generator comprehensions instead of regex or `str.isdigit()` when strictly retaining ASCII numeric characters.
