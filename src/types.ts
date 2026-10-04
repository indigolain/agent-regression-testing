/**
 * A function that sends a question to the agent and returns the response text.
 */
export type AgentFunction = (question: string) => Promise<string>;

/**
 * A function that sends a prompt to the evaluation LLM and returns the response text.
 */
export type EvaluationLLM = (prompt: string) => Promise<string>;

/**
 * The verdict for a single criterion, as returned by a StructuredJudge.
 */
export interface CriterionVerdict {
  met: boolean;
  /** Human-readable justification. Defaults to a confidence summary when omitted. */
  reasoning?: string;
  /** Calibrated probability that the criterion is met, from zero to one. */
  confidence?: number;
}

/**
 * A judge that evaluates every criterion for one response in a single call.
 *
 * Returns one verdict per criterion, in the same order as `criteria`. Use this
 * instead of EvaluationLLM when the judge speaks in structured values rather
 * than text, or when it can answer all criteria in one request.
 */
export type StructuredJudge = (input: {
  question: string;
  response: string;
  criteria: string[];
}) => Promise<CriterionVerdict[]>;

/**
 * The evaluation outcome for a single criterion.
 */
export interface CriterionResult {
  criterion: string;
  met: boolean;
  reasoning: string;
  /** Calibrated probability that the criterion is met. Only set by a StructuredJudge. */
  confidence?: number;
}

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
  criteriaResults: CriterionResult[];
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
  /**
   * Text-based judge, called once per criterion with a rendered prompt. Its reply
   * must contain `MET: YES|NO` and `REASONING:`.
   * Required unless `structuredJudge` is set.
   */
  evaluationLLM?: EvaluationLLM;
  /**
   * Structured judge, called once per response with all of its criteria.
   * Takes precedence over `evaluationLLM` when both are set, and makes
   * `evaluationPromptTemplate` and `interCallDelay` inapplicable.
   */
  structuredJudge?: StructuredJudge;
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
