## 2024-05-24 - HTML string injection bottleneck
**Learning:** In a codebase manipulating massive HTML strings, using `re.sub` within a loop over a large set of keys leads to an O(M*N) complexity bottleneck (M = keys, N = string size). Re-scanning the string repeatedly is extremely slow.
**Action:** Always prefer a single pass over large text blobs. Build a pre-compiled regex matching all potential targets and use a set lookup inside the replacement function to filter matches in O(N).
