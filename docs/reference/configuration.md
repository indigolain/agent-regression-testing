# Configuration Reference

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
