---
name: codereview
description: Reviews code changes for bugs, style issues, and best practices. Use when reviewing PRs or checking code quality.
---

# Code Review Skill

When reviewing code, follow these steps:

## Review checklist

1. **Correctness**: Does the code do what it's supposed to? Check logic, loops, and condition branches.
2. **Edge cases**: Are error conditions handled? Null checks, empty lists, connection failures, etc.
3. **Style**: Does it follow project conventions? Naming, file structure, and documentation.
4. **Performance**: Are there obvious inefficiencies? O(N^2) complexity where O(N) is possible, redundant database calls, etc.
5. **Security**: Look for common vulnerabilities (SQL Injection, XSS, insecure storage).

## Using Scripts

You can use the provided scripts to get objective metrics:
- Run `python scripts/analyze_metrics.py <file_path>` to get complexity scores.

## How to provide feedback

- Be specific about what needs to change.
- Explain why, not just what (cite best practices).
- Suggest alternatives when possible using diff blocks.
