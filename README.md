# agent-regression-testing

A standalone library for AI agent regression testing using an LLM-as-judge approach with criteria scoring, keyword matching, deterministic assertions on tool calls and state, and baseline regression detection.

## Contents

- [Features](#features)
- [Installation](#installation)
- [Getting Started](#getting-started)
  - [1. Initialize config files](#1-initialize-config-files)
  - [2. Edit your test cases](#2-edit-your-test-cases)
  - [3. Configure settings](#3-configure-settings)
  - [4. Write your test runner](#4-write-your-test-runner)
- [API](#api)
  - [CLI](#cli)
  - [Functions](#functions)
- [Choosing a Judge](#choosing-a-judge)
  - [`evaluationLLM` — text in, text out](#evaluationllm--text-in-text-out)
  - [`structuredJudge` — one call, all criteria](#structuredjudge--one-call-all-criteria)
  - [Example: Jev (TypeSafe System One) as the judge](#example-jev-typesafe-system-one-as-the-judge)
- [Deterministic Assertions](#deterministic-assertions)
  - [Reporting a trace from your agent](#reporting-a-trace-from-your-agent)
  - [Assertion types](#assertion-types)
  - [Checking database or other state](#checking-database-or-other-state)
  - [Required vs. scored assertions](#required-vs-scored-assertions)
- [Configuration Reference](#configuration-reference)
- [Built-in Prompt Templates](#built-in-prompt-templates)
- [License](#license)

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

## Getting Started

### 1. Initialize config files

```bash
npx agent-regression-testing init
```

This creates:

```
agent-regression/
  config.yml         # Scoring weights, thresholds, retry settings, file paths
  test-cases.json    # Example test case to customize
```

You can also specify a target directory:

```bash
npx agent-regression-testing init ./tests
```

### 2. Edit your test cases

Open `agent-regression/test-cases.json` and define your test cases:

```json
[
  {
    "id": "greeting",
    "category": "general",
    "question": "Hello, what can you do?",
    "expectedCriteria": [
      "Describes available capabilities",
      "Is polite and professional"
    ],
    "keywords": ["help"],
    "minResponseLength": 50
  }
]
```

### 3. Configure settings

Edit `agent-regression/config.yml` to tune scoring and behavior. Paths in the config are resolved relative to the config file's directory.

```yaml
scoringWeights:
  criteria: 0.6
  keywords: 0.3
  length: 0.1

passThreshold: 0.7
regressionThreshold: 0.2

retryConfig:
  maxRetries: 3
  initialDelay: 2000
  backoffMultiplier: 2
  retryOnStatusCodes:
    - 429

interCallDelay: 500

saveResults: true
outputDir: .
testCasesPath: ./test-cases.json
baselinePath: ./baseline.json
```

You can also provide a custom evaluation prompt template:

```yaml
evaluationPromptTemplate: |
  You are an AI response evaluator.

  Question: {{question}}
  Response: {{response}}
  Criterion: {{criterion}}

  MET: [YES/NO]
  REASONING: [1-2 sentences]
```

### 4. Write your test runner

`loadConfig()` reads the YAML config and automatically loads test cases and baseline data from the paths specified in the config file. You only need to inject your agent and evaluation LLM:

```typescript
import {
  loadConfig,
  runTests,
  type RunnerConfig,
} from "agent-regression-testing";

const fileConfig = await loadConfig("./agent-regression/config.yml");
// fileConfig.testCases  — loaded from testCasesPath
// fileConfig.baseline   — loaded from baselinePath (undefined if not found)

const config: RunnerConfig = {
  ...fileConfig,
  testCases: fileConfig.testCases!,
  agent: async (question) => {
    // Wire your agent here
    const response = await myAgent.generate(question);
    return response.text;
  },
  evaluationLLM: async (prompt) => {
    // Wire your evaluation LLM here
    const result = await generateText({ model: myModel, prompt });
    return result.text;
  },
};

const { report, exitCode } = await runTests(config);
console.log(report);
process.exit(exitCode);
```

## API

### CLI

#### `npx agent-regression-testing init [dir]`

Scaffolds default `config.yml` and `test-cases.json` files. Skips files that already exist.

### Functions

#### `init(options?)`

Programmatic equivalent of the CLI init command. Returns `{ created: string[], skipped: string[] }`.

```typescript
import { init } from "agent-regression-testing";

const { created, skipped } = await init({
  outputDir: "./tests",
  configPath: "agent-regression/config.yml",    // relative to outputDir
  testCasesPath: "agent-regression/cases.json", // relative to outputDir
  skipExisting: true,                           // default: true
});
```

#### `loadConfig(filePath)`

Loads and validates a YAML config file. If `testCasesPath` and/or `baselinePath` are specified in the config, the referenced files are loaded automatically (paths resolved relative to the config file's directory). Returns a `LoadedConfig` object (extends `ConfigFile` with `testCases` and `baseline`).

- If `testCasesPath` is set but the file doesn't exist, an error is thrown.
- If `baselinePath` is set but the file doesn't exist, `baseline` is left `undefined`.

#### `parseConfig(yamlString)`

Parses and validates a YAML string. Returns a `ConfigFile` object (does not include `testCases` or `baseline` — use `loadConfig()` for that).

#### `runTests(config: RunnerConfig)`

Main test runner. Accepts test cases, an agent function, and an evaluation LLM, plus optional `checks`, `beforeEach` and `afterEach` for [deterministic assertions](#deterministic-assertions). Returns results, a markdown report, and an exit code.

#### `evaluateResponse(testCase, response, config)`

Evaluates a single response against a test case using the configured judge — `structuredJudge` if set, otherwise `evaluationLLM`. See [Choosing a Judge](#choosing-a-judge). `response` may be a string or an `AgentRun`; the test case's [assertions](#deterministic-assertions) run against it.

#### `evaluateAssertions(assertions, run, testCase, context?)`

Runs deterministic assertions against an `AgentRun` on their own, without scoring. `context` takes `checks` and `skillDetection`.

#### `normalizeTestCases(raw)`

Validates test cases parsed from JSON and fills in defaults for optional fields. `loadConfig()` calls it for you.

#### `compareWithBaseline(current, baseline, threshold?)`

Compares current results with baseline results. Returns comparison details including regressions and improvements.

#### `generateReport(results, comparisons?)`

Generates a markdown summary report.

#### `loadBaseline(filePath)` / `saveBaseline(filePath, results)` / `backupBaseline(filePath)`

Baseline file management utilities.

#### `withRetry(fn, config?)`

Generic retry utility with exponential backoff.

#### `buildEvaluationPrompt(template, params)`

Substitutes `{{question}}`, `{{response}}`, and `{{criterion}}` placeholders in a prompt template.

## Choosing a Judge

The library accepts two judge interfaces. Supply exactly one — `structuredJudge` wins if both are set. Omitting both is fine when no test case has `expectedCriteria` (a [deterministic-only](#deterministic-assertions) suite); otherwise test cases with criteria fail with an error.

### `evaluationLLM` — text in, text out

```typescript
type EvaluationLLM = (prompt: string) => Promise<string>;
```

Called **once per criterion** with `evaluationPromptTemplate` rendered, and must reply with `MET: YES|NO` and `REASONING:`. This is the right choice for chat models, which can explain themselves in prose. Note that calls are sequential and separated by `interCallDelay` (default 500ms), so a test case with five criteria makes five calls.

### `structuredJudge` — one call, all criteria

```typescript
type StructuredJudge = (input: {
  question: string;
  response: string;
  criteria: string[];
}) => Promise<CriterionVerdict[]>;

interface CriterionVerdict {
  met: boolean;
  reasoning?: string;   // defaults to a confidence summary
  confidence?: number;  // calibrated probability, 0..1 — kept on the result
}
```

Return **one verdict per criterion, in the same order as `criteria`**; a length mismatch fails the test case with a diagnostic rather than silently misaligning verdicts. `evaluationPromptTemplate` and `interCallDelay` do not apply — the judge owns its own prompting, and there is only one call to pace.

Use this for judges that answer in structured values rather than text, or that can answer a whole batch of questions at once.

### Example: Jev (TypeSafe System One) as the judge

[Jev](https://typesafe.ai) answers a map of named yes/no (`noul`) questions in a single request and returns a calibrated probability for each, which maps onto `structuredJudge` directly:

```typescript
import { TypeSafeClient, noul } from "@typesafe-ai/sdk";
import type { NoulQuestion } from "@typesafe-ai/sdk";
import type { RunnerConfig, StructuredJudge } from "agent-regression-testing";

const jev = new TypeSafeClient(); // reads TYPESAFE_API_KEY

const jevJudge: StructuredJudge = async ({ question, response, criteria }) => {
  const questions: Record<string, NoulQuestion> = {};
  criteria.forEach((criterion, i) => {
    questions[`c${i}`] = noul("Does the response satisfy this criterion?", {
      true: criterion,
    });
  });

  const { answers } = await jev.systemOne({ state: { question, response }, questions });

  return criteria.map((_, i) => {
    const answer = answers[`c${i}`];
    if (!answer) throw new Error(`Jev returned no answer for criterion ${i}`);
    return { met: answer.noul >= 0.5, confidence: answer.noul }; // noul is P(yes), 0..1
  });
};

const config: RunnerConfig = {
  ...fileConfig,
  testCases: fileConfig.testCases!,
  agent: async (question) => (await myAgent.generate(question)).text,
  structuredJudge: jevJudge,
};
```

Two things to watch: the SDK retries internally, so leave `retryConfig` unset (or set `maxRetries: 1`) to avoid stacking retries on top of `withRetry`; and Jev returns no reasoning prose, so `reasoning` in the report becomes a confidence figure.

## Deterministic Assertions

LLM-as-judge is good at judging *what the agent said*. To check *what the agent did*, add `assertions` to a test case. They are evaluated in code, so they give the same answer every run.

```json
{
  "id": "refund-flow",
  "question": "Please refund order #123",
  "assertions": [
    { "type": "skillTriggered", "name": "refunds" },
    { "type": "toolCalled", "name": "lookup_order", "args": { "orderId": "123" } },
    { "type": "toolOrder", "names": ["lookup_order", "issue_refund"] },
    { "type": "toolNotCalled", "name": "delete_customer" },
    { "type": "regex", "pattern": "refund (has been|was) issued", "flags": "i" },
    { "type": "check", "name": "orderMarkedRefunded", "params": { "orderId": "123" } }
  ]
}
```

In test case JSON, `expectedCriteria` and `keywords` default to `[]`, `minResponseLength` to `0`, and `category` to `"general"`, so a test case can consist of assertions only. A suite where no test case has criteria needs no judge at all.

### Reporting a trace from your agent

Assertions on tools and skills need to know what the agent called. Have your agent function return an `AgentRun` instead of a string:

```typescript
interface AgentRun {
  text: string;
  toolCalls?: { name: string; args?: unknown; result?: unknown }[];
  metadata?: Record<string, unknown>; // available to check functions
}
```

The agent also receives the current test case as a second argument. Returning a plain string keeps working, but then tool and skill assertions fail with a message asking for a trace (rather than `toolNotCalled` passing by default).

Most agent frameworks expose tool calls through step results, a message stream, or callbacks. Collect them into `toolCalls`:

```typescript
import type { ToolCall, TracedAgentFunction } from "agent-regression-testing";

const myTracedAgent: TracedAgentFunction = async (question) => {
  const toolCalls: ToolCall[] = [];
  const text = await myAgent.run(question, {
    onToolCall: (name, args) => toolCalls.push({ name, args }),
  });
  return { text, toolCalls };
};
```

### Assertion types

| Type | Fields | Passes when |
|------|--------|-------------|
| `toolCalled` | `name`, `args?`, `times?` | `name` was called (with matching `args`) at least once, or exactly `times` times |
| `toolNotCalled` | `name`, `args?` | No call to `name` (with matching `args`) was made |
| `toolOrder` | `names` | The tools were called in this relative order; other calls may sit between them |
| `skillTriggered` | `name` | The skill was invoked (see `skillDetection` below) |
| `regex` | `pattern`, `flags?` | The response text matches |
| `check` | `name`, `params?` | The [check function](#checking-database-or-other-state) registered as `name` passes |

`args` is a partial match: every key you give must deep-equal the call's argument, and extra arguments are ignored. Arrays must match element by element.

Every assertion also takes an optional `description`, used as its label in reports and baseline comparisons.

Skills show up in the trace as a tool call. By default `skillTriggered` looks for a `Skill` tool call whose `skill` argument is the skill's name, which is how the Claude Agent SDK reports them. For other frameworks, set `skillDetection` in the config:

```yaml
skillDetection:
  toolName: load_skill
  argKey: id
```

### Checking database or other state

For anything the trace can't show, such as a row the agent was supposed to update, register check functions by name and reference them from test cases. Use the `beforeEach` and `afterEach` hooks to put state in a known shape for every test:

```typescript
const config: RunnerConfig = {
  ...fileConfig,
  testCases: fileConfig.testCases!,
  agent: myTracedAgent,
  checks: {
    orderMarkedRefunded: async ({ params, run, testCase }) => {
      const order = await db.orders.find(params!.orderId as string);
      return { passed: order.status === "refunded", message: `status=${order.status}` };
    },
  },
  beforeEach: async (testCase) => db.seed(testCase.id),
  afterEach: async () => db.reset(),
};
```

A check returns a boolean or `{ passed, message? }`. A check that throws, or a name with no registered check, fails the assertion with an explanatory message.

Checks run after the agent answers and before `afterEach`. If `beforeEach` throws, the agent is not run and the test case fails. `afterEach` runs even when the test case errored, and a throw from it also fails the test case, since later tests could otherwise run against leftover state.

### Required vs. scored assertions

By default an assertion is **required**: if it fails, the test case fails whatever its score. Set `"required": false` to make it count towards the score instead. When a test case has scored assertions, the score gains an `assertions` component (weight `scoringWeights.assertions`, default `0.3`), and all weights are normalized to sum to one. Test cases without scored assertions are scored exactly as before.

Assertion results are saved with the other results. When comparing against a baseline, an assertion that passed in the baseline and fails now is reported as a regression even if the score barely moved. Baselines recorded before assertions existed are compared on score alone.

## Configuration Reference

All fields are optional. Defaults are applied by the library when not specified. Paths are resolved relative to the config file's directory.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `scoringWeights.criteria` | `number` | `0.6` | Weight for LLM criteria evaluation |
| `scoringWeights.keywords` | `number` | `0.3` | Weight for keyword matching |
| `scoringWeights.length` | `number` | `0.1` | Weight for response length check |
| `scoringWeights.assertions` | `number` | `0.3` | Weight for assertions with `required: false` (only for test cases that have them) |
| `skillDetection.toolName` | `string` | `"Skill"` | Tool name that signals a skill invocation |
| `skillDetection.argKey` | `string` | `"skill"` | Argument of that tool holding the skill name |
| `passThreshold` | `number` | `0.7` | Minimum score to pass |
| `regressionThreshold` | `number` | `0.2` | Score decrease that constitutes a regression |
| `evaluationPromptTemplate` | `string` | Japanese template | Prompt with `{{question}}`, `{{response}}`, `{{criterion}}` placeholders (`evaluationLLM` only) |
| `retryConfig.maxRetries` | `number` | `3` | Max retry attempts for LLM calls |
| `retryConfig.initialDelay` | `number` | `2000` | Initial delay in ms before first retry |
| `retryConfig.backoffMultiplier` | `number` | `2` | Multiplier for exponential backoff |
| `retryConfig.retryOnStatusCodes` | `number[]` | `[429]` | HTTP status codes that trigger a retry |
| `interCallDelay` | `number` | `500` | Delay in ms between criterion evaluations (`evaluationLLM` only) |
| `saveResults` | `boolean` | — | Whether to save results and reports to disk |
| `outputDir` | `string` | — | Directory for result and report files |
| `testCasesPath` | `string` | — | Path to test cases JSON file (auto-loaded by `loadConfig`) |
| `baselinePath` | `string` | — | Path to baseline JSON file (auto-loaded by `loadConfig`) |

## Built-in Prompt Templates

The library includes two default evaluation prompt templates:

- `DEFAULT_EVALUATION_PROMPT_JA` — Japanese
- `DEFAULT_EVALUATION_PROMPT_EN` — English

```typescript
import {
  DEFAULT_EVALUATION_PROMPT_EN,
  DEFAULT_EVALUATION_PROMPT_JA,
} from "agent-regression-testing";
```

## License

MIT
