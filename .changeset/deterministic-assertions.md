---
"agent-regression-testing": minor
---

Add deterministic assertions alongside LLM-as-judge evaluation. Test cases can now assert which tools the agent called (`toolCalled`, `toolNotCalled`, `toolOrder`), which skill it triggered (`skillTriggered`), regex matches on the response (`regex`), and custom named checks such as database state (`check`). Agents may return an `AgentRun` with a tool-call trace instead of a string, and `runTests` accepts `checks`, `beforeEach` and `afterEach`. Required assertions gate pass/fail; optional ones are scored via `scoringWeights.assertions`. Assertions that flip from pass to fail are reported as baseline regressions. `expectedCriteria`, `keywords` and `minResponseLength` are now optional in test case JSON, and a judge is only needed when some test case has criteria. Existing configs, test cases and baselines work unchanged.
