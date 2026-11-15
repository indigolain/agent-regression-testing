# Getting Started

## Installation

```bash
npm install agent-regression-testing
```

## 1. Initialize config files

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

## 2. Edit your test cases

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

## 3. Configure settings

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

## 4. Write your test runner

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
