---
layout: home

hero:
  name: agent-regression-testing
  text: Regression tests for AI agents
  tagline: Score agent responses with an LLM judge, assert on the tools and state they touch, and catch regressions against a baseline.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/indigolain/agent-regression-testing

features:
  - title: LLM-as-judge
    details: Check responses against plain-language criteria, with a text judge or a structured judge that scores every criterion in one call.
    link: /guide/judges
  - title: Deterministic assertions
    details: Assert which tools the agent called, with which arguments and in what order, which skill it triggered, and what changed in your database.
    link: /guide/assertions
  - title: Baseline regressions
    details: Compare each run against a saved baseline and fail CI when scores drop or assertions stop passing.
    link: /guide/test-cases-and-scoring#baselines-and-regressions
  - title: Results dashboard
    details: One self-contained HTML page with pass-rate trends, a test-by-run matrix, the most-failing assertions, and a drill-down into every run.
    link: /guide/dashboard
  - title: Bring your own models
    details: Inject your agent and judge as plain functions. Thresholds, weights and file paths live in a YAML config.
    link: /reference/configuration
---

<img src="/media/demo.gif" alt="Demo: running three test cases in a terminal. The LLM judge passes all of them, but refund-flow fails and is flagged as a regression; the report shows the agent refunded order 456 instead of 123" style="margin: 0 auto 2rem; border-radius: 12px;">

In this demo, the agent answers every question politely, so the LLM judge passes all three test cases. But it refunded order #456 instead of #123. The `toolCalled` assertion and the database check catch that, and the baseline comparison flags it as a regression.

## How it works

```mermaid
flowchart LR
    TC["Test case<br/>question, criteria,<br/>keywords, assertions"] --> A["Your agent"]
    A --> R["AgentRun<br/>text + toolCalls"]
    R --> J["LLM judge<br/>expectedCriteria"]
    R --> K["Keyword &amp;<br/>length checks"]
    R --> D["Deterministic assertions<br/>tools, skills, regex,<br/>database checks"]
    J --> S{"Score &ge; threshold<br/>and required<br/>assertions pass?"}
    K --> S
    D --> S
    S -->|yes| P["PASS"]
    S -->|no| F["FAIL"]
    P --> B["Compare with baseline"]
    F --> B
    B --> O["Markdown report<br/>+ exit code for CI"]
```
