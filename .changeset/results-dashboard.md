---
"agent-regression-testing": minor
---

Add a static HTML dashboard for test results. `agent-regression-testing dashboard [dir]` (or `writeDashboard()`) reads every `results-*.json` saved in a directory and writes a self-contained `dashboard.html` showing: the latest pass rate and changes since the previous run, pass rate and average score over time, a test case × run matrix, the most-failing assertions, and a per-run drill-down with the response, verdicts and tool calls. Set `dashboard: true` in the config to regenerate it after every run. Also exports `loadRunHistory()`, `buildDashboardModel()` and `generateDashboard()`.
