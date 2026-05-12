## 2025-02-14 - Python String Whitespace Normalization
**Learning:** Using `re.sub(r"\s+", " ", text)` or `re.sub(r"\s+", "", text)` for normalizing or compacting whitespace in Python is significantly slower than string methods like `" ".join(text.split())` or `"".join(text.split())`. Benchmarks showed an ~80-85% performance improvement for string split/join operations over regex for whitespace collapsing/compaction.
**Action:** When needing to compact all whitespace (e.g., removing spaces entirely) use `"".join(text.split())`. When needing to collapse multiple whitespaces into a single space, use `" ".join(text.split())`. Avoid regex for simple whitespace normalization.

## 2025-02-14 - Python Alphanumeric Character Filtering
**Learning:** For stripping out characters from a string to leave only digits, or specific safe characters (e.g. for NCM codes `[0-9]` or alphanumeric for IDs), list/generator comprehensions with string checks (`"".join(c for c in text if c in "0123456789")`) are faster than regex substitutions (`re.sub(r"[^0-9]", "", text)`), showing around 20-25% improvement.
**Action:** Use generator comprehensions over regex substitutions when doing simple character whitelisting/filtering in Python.
