# API

## CLI

### `npx agent-regression-testing init [dir]`

Scaffolds default `config.yml` and `test-cases.json` files. Skips files that already exist.

## Functions

### `init(options?)`

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

### `loadConfig(filePath)`

Loads and validates a YAML config file. If `testCasesPath` and/or `baselinePath` are specified in the config, the referenced files are loaded automatically (paths resolved relative to the config file's directory). Returns a `LoadedConfig` object (extends `ConfigFile` with `testCases` and `baseline`).

- If `testCasesPath` is set but the file doesn't exist, an error is thrown.
- If `baselinePath` is set but the file doesn't exist, `baseline` is left `undefined`.

### `parseConfig(yamlString)`

Parses and validates a YAML string. Returns a `ConfigFile` object (does not include `testCases` or `baseline` — use `loadConfig()` for that).

### `runTests(config: RunnerConfig)`

Main test runner. Accepts test cases, an agent function, and an evaluation LLM, plus optional `checks`, `beforeEach` and `afterEach` for [deterministic assertions](/guide/assertions). Returns results, a markdown report, and an exit code.

### `evaluateResponse(testCase, response, config)`

Evaluates a single response against a test case using the configured judge — `structuredJudge` if set, otherwise `evaluationLLM`. See [Choosing a Judge](/guide/judges). `response` may be a string or an `AgentRun`; the test case's [assertions](/guide/assertions) run against it.

### `evaluateAssertions(assertions, run, testCase, context?)`

Runs deterministic assertions against an `AgentRun` on their own, without scoring. `context` takes `checks` and `skillDetection`.

### `normalizeTestCases(raw)`

Validates test cases parsed from JSON and fills in defaults for optional fields. `loadConfig()` calls it for you.

### `compareWithBaseline(current, baseline, threshold?)`

Compares current results with baseline results. Returns comparison details including regressions and improvements.

### `generateReport(results, comparisons?)`

Generates a markdown summary report.

### `loadBaseline(filePath)` / `saveBaseline(filePath, results)` / `backupBaseline(filePath)`

Baseline file management utilities.

### `withRetry(fn, config?)`

Generic retry utility with exponential backoff.

### `buildEvaluationPrompt(template, params)`

Substitutes `{{question}}`, `{{response}}`, and `{{criterion}}` placeholders in a prompt template.

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
