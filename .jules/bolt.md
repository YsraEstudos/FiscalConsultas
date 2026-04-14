## 2026-04-14 - Python lru_cache Memory Leak Pitfall
**Learning:** Directly applying `@functools.lru_cache` to a class instance method caches the `self` instance along with arguments, which can lead to memory leaks across instance boundaries.
**Action:** Extract caching to module-level static functions or decorate standalone `@staticmethod` functions to guarantee bounded, instance-free cache lifetimes.
