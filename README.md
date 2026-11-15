# agent-regression-testing

A standalone library for AI agent regression testing using an LLM-as-judge approach with criteria scoring, keyword matching, deterministic assertions on tool calls and state, and baseline regression detection.

**📖 Documentation: https://indigolain.github.io/agent-regression-testing/**

## Features

- **LLM-as-judge evaluation** — uses an injected LLM to evaluate agent responses against criteria
- **Keyword matching** — checks for expected keywords in responses
- **Deterministic assertions** — assert which tools the agent called (and with what arguments, in what order), which skill it triggered, regex matches, and custom checks such as database state
- **Baseline regression detection** — compares results against a saved baseline to detect regressions
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

## Learn more

- [Getting Started](https://indigolain.github.io/agent-regression-testing/guide/getting-started): the full walkthrough
- [Test Cases & Scoring](https://indigolain.github.io/agent-regression-testing/guide/test-cases-and-scoring): fields, how scores are calculated, baselines
- [Choosing a Judge](https://indigolain.github.io/agent-regression-testing/guide/judges): `evaluationLLM` vs. `structuredJudge`
- [Deterministic Assertions](https://indigolain.github.io/agent-regression-testing/guide/assertions): tool calls, skills, and database checks
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
