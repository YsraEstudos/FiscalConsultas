## 2024-04-29 - [Bounded LRU Cache for Stemmer]
**Learning:** Instantiating `PortugueseStemmer` inside the `NeshTextProcessor` facade and directly calling its `stem` method causes redundant CPU-intensive text normalizations for the same words, particularly across large datasets or repetitive FTS queries where the vocabulary is bounded. Applying `@functools.lru_cache` to a module-level proxy function significantly speeds up NLP stemming. Never apply `lru_cache` directly to an instance method.
**Action:** Always use a module-level bounded `lru_cache` on a decoupled proxy function when caching results from an instance method (e.g., stemming) across multiple instances to avoid including `self` in the cache key and causing cache misses or memory leaks.

## 2024-05-18 - [Optimizing String Filtering and Whitespace Parsing]
**Learning:** Using regex (`re.sub`) for simple operations like extracting only digits or collapsing whitespace is slower due to parsing and matching overhead.
**Action:** Replace `re.sub` digit filtering with `" ".join(c for c in s if c in "0123456789")` and replace regex whitespace collapsing with internal string `s.split()` & `" ".join()` logic.
