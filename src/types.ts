/**
 * A function that sends a question to the agent and returns the response text.
 */
export type AgentFunction = (question: string) => Promise<string>;

/**
 * A function that sends a prompt to the evaluation LLM and returns the response text.
 */
export type EvaluationLLM = (prompt: string) => Promise<string>;

export interface TestCase {
  id: string;
  category: string;
  question: string;
  expectedCriteria: string[];
  keywords: string[];
  minResponseLength: number;
}

export interface EvaluationResult {
  testId: string;
  question: string;
  response: string;
  passed: boolean;
  score: number;
  criteriaResults: {
    criterion: string;
    met: boolean;
    reasoning: string;
  }[];
  keywordMatches: {
    keyword: string;
    found: boolean;
  }[];
  responseLength: number;
  evaluationTime: number;
  timestamp: string;
}

export interface ComparisonResult {
  testId: string;
  baselineScore: number;
  currentScore: number;
  delta: number;
  regression: boolean;
  improvement: boolean;
}

export interface ScoringWeights {
  criteria: number;
  keywords: number;
  length: number;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  backoffMultiplier: number;
  retryOnStatusCodes: number[];
}

export interface EvaluationConfig {
  evaluationLLM: EvaluationLLM;
  scoringWeights?: ScoringWeights;
  passThreshold?: number;
  regressionThreshold?: number;
  evaluationPromptTemplate?: string;
  retryConfig?: RetryConfig;
  interCallDelay?: number;
}

export interface RunnerConfig extends EvaluationConfig {
  agent: AgentFunction;
  testCases: TestCase[];
  baseline?: EvaluationResult[];
  saveResults?: boolean;
  outputDir?: string;
}

/**
 * YAML-serializable configuration.
 * Contains all settings that can be expressed in a config file.
 * Functions (agent, evaluationLLM) must be provided programmatically.
 */
export interface ConfigFile {
  scoringWeights?: ScoringWeights;
  passThreshold?: number;
  regressionThreshold?: number;
  evaluationPromptTemplate?: string;
  retryConfig?: RetryConfig;
  interCallDelay?: number;
  saveResults?: boolean;
  outputDir?: string;
  testCasesPath?: string;
  baselinePath?: string;
}

/**
 * Result of loadConfig(). Extends ConfigFile with auto-loaded data
 * from testCasesPath and baselinePath.
 */
export interface LoadedConfig extends ConfigFile {
  /** Loaded from testCasesPath. Undefined if testCasesPath not set. */
  testCases?: TestCase[];
  /** Loaded from baselinePath. Undefined if file not found or baselinePath not set. */
  baseline?: EvaluationResult[];
}
