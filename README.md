# agent-regression-testing

A standalone library for AI agent regression testing using an LLM-as-judge approach with criteria scoring, keyword matching, and baseline regression detection.

## Features

- **LLM-as-judge evaluation** — uses an injected LLM to evaluate agent responses against criteria
- **Keyword matching** — checks for expected keywords in responses
- **Baseline regression detection** — compares results against a saved baseline to detect regressions
- **YAML configuration** — define scoring weights, thresholds, retry settings, and file paths in a config file; test cases and baseline are loaded automatically
- **Dependency injection** — consumers inject their own LLM and agent via simple function signatures

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

Main test runner. Accepts test cases, an agent function, and an evaluation LLM. Returns results, a markdown report, and an exit code.

#### `evaluateResponse(testCase, response, config)`

Evaluates a single response against a test case using the LLM judge.

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

## Configuration Reference

All fields are optional. Defaults are applied by the library when not specified. Paths are resolved relative to the config file's directory.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `scoringWeights.criteria` | `number` | `0.6` | Weight for LLM criteria evaluation |
| `scoringWeights.keywords` | `number` | `0.3` | Weight for keyword matching |
| `scoringWeights.length` | `number` | `0.1` | Weight for response length check |
| `passThreshold` | `number` | `0.7` | Minimum score to pass |
| `regressionThreshold` | `number` | `0.2` | Score decrease that constitutes a regression |
| `evaluationPromptTemplate` | `string` | Japanese template | Prompt with `{{question}}`, `{{response}}`, `{{criterion}}` placeholders |
| `retryConfig.maxRetries` | `number` | `3` | Max retry attempts for LLM calls |
| `retryConfig.initialDelay` | `number` | `2000` | Initial delay in ms before first retry |
| `retryConfig.backoffMultiplier` | `number` | `2` | Multiplier for exponential backoff |
| `retryConfig.retryOnStatusCodes` | `number[]` | `[429]` | HTTP status codes that trigger a retry |
| `interCallDelay` | `number` | `500` | Delay in ms between criterion evaluations |
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
