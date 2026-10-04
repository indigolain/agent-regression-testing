---
"agent-regression-testing": minor
---

Add `structuredJudge`, a second judge interface for LLM-as-judge evaluation. It receives a response with all of its criteria and returns one verdict per criterion in a single call, optionally carrying a calibrated `confidence` probability that is kept on the result. Judges that answer in structured values rather than text — such as TypeSafe's Jev — now plug in without round-tripping through the `MET:`/`REASONING:` text format.

Supply one judge or the other: `structuredJudge` takes precedence when both are set, and omitting both now throws at evaluation time.

**Breaking (types only):** `EvaluationConfig.evaluationLLM` is now optional, so reading it off a config no longer typechecks without narrowing — `c.evaluationLLM(prompt)` and passing `c.evaluationLLM` to something expecting `EvaluationLLM` both fail under `strict`. Constructing a config is unaffected, as is runtime behavior for any config that already supplied `evaluationLLM`. A consequence of the same change: a config with neither judge now compiles and fails at runtime rather than failing to compile.

`criteriaResults` entries are now the exported `CriterionResult` type — structurally identical to the inline type it replaces, plus the optional `confidence`.
