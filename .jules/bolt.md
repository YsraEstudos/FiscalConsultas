## 2026-04-10 - Regex Compilation Overhead
**Learning:** Python `re.sub` inline calls inside string processing functions can create measurable overhead if called frequently inside parser loops, even if Python caches recent regex patterns internally.
**Action:** When implementing new parsing logic or optimizing existing utilities, pre-compile all static regular expressions using `re.compile()` at the module level.
