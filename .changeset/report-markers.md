---
"agent-regression-testing": patch
---

Mark passed and failed criteria, assertions and keywords in the Markdown report with ✅ and ❌ instead of `+` and `-`. Markdown read `- +` and `- -` as nested list bullets, so the markers disappeared when the report was rendered (e.g. on GitHub), hiding which checks passed.
