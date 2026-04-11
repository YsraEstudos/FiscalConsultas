## 2026-04-11 - [O(N*K) HTML Regex Replacement Bottleneck]
**Learning:** In `backend/presentation/renderer.py`, iterating over a list of comment anchor IDs and performing a full-document regex search and replace for each one caused significant performance degradation as the number of comments grew (O(N*K) where N=doc length, K=num comments).
**Action:** Always replace per-key regex loops over large text blocks with a single-pass regex that finds all targets (e.g., all `id="..."` attributes) and filters matches against an O(1) set lookup, reducing time complexity to O(N+K).
