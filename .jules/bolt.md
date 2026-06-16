## 2024-04-29 - [Bounded LRU Cache for Stemmer]
**Learning:** Instantiating `PortugueseStemmer` inside the `NeshTextProcessor` facade and directly calling its `stem` method causes redundant CPU-intensive text normalizations for the same words, particularly across large datasets or repetitive FTS queries where the vocabulary is bounded. Applying `@functools.lru_cache` to a module-level proxy function significantly speeds up NLP stemming. Never apply `lru_cache` directly to an instance method.
**Action:** Always use a module-level bounded `lru_cache` on a decoupled proxy function when caching results from an instance method (e.g., stemming) across multiple instances to avoid including `self` in the cache key and causing cache misses or memory leaks.

## 2024-05-18 - [Fast string cleaning]
**Learning:** Using `re.sub` for simple character filtering or whitespace normalization is significantly slower than native string methods in Python.
**Action:** Replace `re.sub(r"[^0-9]", "", s)` with `"".join(c for c in s if c in "0123456789")` or similar generator comprehensions, replace `re.sub(r"\s+", "", s)` with `"".join(s.split())`, and replace `re.sub(r"\s+", " ", s)` with `" ".join(s.split())` for faster execution. For splitting strings by multiple delimiters, chained `.replace()` calls before `.split()` are much faster than `re.split()`.
