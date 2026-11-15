# agent-regression-testing

A standalone library for AI agent regression testing using an LLM-as-judge approach with criteria scoring, keyword matching, deterministic assertions on tool calls and state, and baseline regression detection.

**📖 Documentation: https://indigolain.github.io/agent-regression-testing/**

<p align="center">
  <img src="docs/public/media/demo.gif" width="800" alt="Demo: running three test cases in a terminal. The LLM judge passes all of them, but refund-flow fails and is flagged as a regression; the report shows the agent refunded order 456 instead of 123">
</p>

## How it works

Each test case sends a question to your agent, then checks the result three ways: an LLM judge for *what it said*, simple keyword and length checks, and deterministic assertions for *what it did*. Results are compared with a saved baseline, so a drop fails CI.

See the [flow diagram in the docs](https://indigolain.github.io/agent-regression-testing/guide/getting-started#how-it-works) for how each step decides.

## Features

- **LLM-as-judge evaluation** — uses an injected LLM to evaluate agent responses against criteria
- **Keyword matching** — checks for expected keywords in responses
- **Deterministic assertions** — assert which tools the agent called (and with what arguments, in what order), which skill it triggered, regex matches, and custom checks such as database state
- **Baseline regression detection** — compares results against a saved baseline to detect regressions
- **Results dashboard** — a self-contained HTML page with pass-rate trends, a test-by-run matrix, the most-failing assertions, and a drill-down into every run
- **YAML configuration** — define scoring weights, thresholds, retry settings, and file paths in a config file; test cases and baseline are loaded automatically
- **Dependency injection** — consumers inject their own LLM and agent via simple function signatures
- **Two judge interfaces** — a text LLM judge, or a structured judge that scores every criterion in one call and reports calibrated confidence

## Installation

```bash
npm install agent-regression-testing
```

## Quick start

Scaffold a config file and an example test case:

```bash
npx agent-regression-testing init
```

Define test cases in `agent-regression/test-cases.json`. Each can use judge criteria, keywords, deterministic assertions, or any mix:

```json
[
  {
    "id": "refund-flow",
    "question": "Please refund order #123",
    "expectedCriteria": ["Confirms the refund politely"],
    "assertions": [
      { "type": "toolCalled", "name": "issue_refund", "args": { "orderId": "123" } },
      { "type": "toolNotCalled", "name": "delete_customer" }
    ]
  }
]
```

Wire in your agent and judge, and run:

```typescript
import { loadConfig, runTests, type RunnerConfig } from "agent-regression-testing";

const fileConfig = await loadConfig("./agent-regression/config.yml");

const config: RunnerConfig = {
  ...fileConfig,
  testCases: fileConfig.testCases!,
  agent: async (question) => {
    const run = await myAgent.run(question);
    return { text: run.text, toolCalls: run.toolCalls }; // or just return the text
  },
  evaluationLLM: async (prompt) => (await myLLM.generate(prompt)).text,
};

const { report, exitCode } = await runTests(config);
console.log(report);
process.exit(exitCode);
```

## Assertion types

Assertions check what the agent *did*, deterministically, alongside the LLM judge:

| Type | Passes when |
|------|-------------|
| `toolCalled` | A tool was called, optionally with matching `args` or an exact number of `times` |
| `toolNotCalled` | A tool was never called (with matching `args`, if given) |
| `toolOrder` | Tools were called in a given order; other calls may come in between |
| `skillTriggered` | A skill was invoked |
| `regex` | The response text matches a pattern |
| `check` | Your own function passes, e.g. a database query confirming the agent updated a row |

Tool and skill assertions need your agent to return its tool calls. See [Deterministic Assertions](https://indigolain.github.io/agent-regression-testing/guide/assertions) for the fields and details.

## What you get

A Markdown report for every run. In this excerpt the judge is satisfied with the answer, but the assertions catch that the agent refunded the wrong order and never updated the database:

<p align="center">
  <img src="docs/public/media/report-failure.png" width="800" alt="Report excerpt: the judge marks both criteria as met, but the toolCalled issue_refund assertion fails because the call had orderId 456, the database check shows order 123 still shipped, and both are listed as assertions now failing against the baseline">
</p>

## Dashboard

Set `dashboard: true` in the config, or run `npx agent-regression-testing dashboard <results dir>`, to turn saved runs into a single HTML page:

<p align="center">
  <img src="docs/public/media/dashboard.png" width="800" alt="Dashboard showing the latest pass rate, a pass rate and average score trend over 14 runs, a test case by run matrix where refund-flow starts failing at run 12, and the most-failing assertions">
</p>

## Learn more

- [Getting Started](https://indigolain.github.io/agent-regression-testing/guide/getting-started): the full walkthrough
- [Test Cases & Scoring](https://indigolain.github.io/agent-regression-testing/guide/test-cases-and-scoring): fields, how scores are calculated, baselines
- [Choosing a Judge](https://indigolain.github.io/agent-regression-testing/guide/judges): `evaluationLLM` vs. `structuredJudge`
- [Deterministic Assertions](https://indigolain.github.io/agent-regression-testing/guide/assertions): tool calls, skills, and database checks
- [Results Dashboard](https://indigolain.github.io/agent-regression-testing/guide/dashboard): trends and drill-downs across runs
- [API](https://indigolain.github.io/agent-regression-testing/reference/api) and [Configuration](https://indigolain.github.io/agent-regression-testing/reference/configuration) reference

## Development

```bash
pnpm install
pnpm test          # run the test suite
pnpm docs:dev      # preview the documentation site locally
```

The documentation lives in [`docs/`](./docs) and deploys to GitHub Pages on every push to `main`.

## License

MIT
