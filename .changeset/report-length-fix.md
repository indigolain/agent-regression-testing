---
"agent-regression-testing": patch
---

Fix two report formatting bugs: the response length verdict compared against a hardcoded 100 characters instead of the test case's `minResponseLength`, and an unchanged score could show a `-0.0%` delta from floating-point rounding. Results now record `minResponseLength` so the report can show it.
