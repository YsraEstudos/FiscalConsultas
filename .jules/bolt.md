## 2024-04-29 - [Bounded LRU Cache for Stemmer]
**Learning:** Instantiating `PortugueseStemmer` inside the `NeshTextProcessor` facade and directly calling its `stem` method causes redundant CPU-intensive text normalizations for the same words, particularly across large datasets or repetitive FTS queries where the vocabulary is bounded. Applying `@functools.lru_cache` to a module-level proxy function significantly speeds up NLP stemming. Never apply `lru_cache` directly to an instance method.
**Action:** Always use a module-level bounded `lru_cache` on a decoupled proxy function when caching results from an instance method (e.g., stemming) across multiple instances to avoid including `self` in the cache key and causing cache misses or memory leaks.

## 2024-05-19 - Regex Substitution in Large Strings
**Learning:** Running `re.sub` inside a loop for each item in a list of keys against a large HTML string scales at $O(N \times L)$, which causes massive slowdowns.
**Action:** For injecting multiple markers based on a list of target IDs, use a single-pass regex to locate all IDs and check them against an O(1) set of target keys. This reduces complexity from $O(N \times L)$ to $O(L)$, resulting in up to a 20x speedup. Additionally, carefully construct regex patterns like `[^\s>]` when parsing HTML tags to avoid ReDoS warnings from SAST tools.
