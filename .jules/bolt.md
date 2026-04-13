## 2024-05-18 - HTML Regex Injection Optimization
**Learning:** When injecting classes into HTML based on a list of IDs (like in the `inject_comment_marks` renderer function), iterating over N IDs and doing a regex pass for each causes O(N*K) performance where K is HTML string length. For large chapters and many comments, this is a significant bottleneck.
**Action:** Replace the iterative regex replacement with a single-pass O(N+K) substitution over all `id="..."` attributes using a capture group to extract the value and an O(1) set lookup to verify if it belongs to the target list.
