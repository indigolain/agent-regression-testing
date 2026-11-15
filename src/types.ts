/**
 * A function that sends a question to the agent and returns the response text.
 */
export type AgentFunction = (question: string) => Promise<string>;

/**
 * One tool (or function) call the agent made while answering.
 */
export interface ToolCall {
  name: string;
  args?: unknown;
  result?: unknown;
}

/**
 * What an agent produced for one question: its final text plus a trace of what
 * it did along the way. Deterministic assertions run against this.
 */
export interface AgentRun {
  text: string;
  /**
   * Every tool call the agent made, in order. Leave undefined when the agent
   * cannot report them; an empty array means "traced, and no tools were called".
   */
  toolCalls?: ToolCall[];
  /** Anything else a named check might want to inspect. */
  metadata?: Record<string, unknown>;
}

/**
 * Context passed to a TracedAgentFunction alongside the question.
 */
export interface AgentContext {
  testCase: TestCase;
}

/**
 * An agent that can report a trace of its run. It may still return plain text.
 */
export type TracedAgentFunction = (
  question: string,
  context: AgentContext,
) => Promise<string | AgentRun>;

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

/**
 * Fields shared by every deterministic assertion.
 */
interface AssertionBase {
  /**
   * When true (the default), a failed assertion fails the test case regardless
   * of its score. When false, the assertion only contributes to the score via
   * `scoringWeights.assertions`.
   */
  required?: boolean;
  /** Label used in reports and baseline comparisons. Generated when omitted. */
  description?: string;
}

/** The agent called tool `name`, optionally with arguments matching `args`. */
export interface ToolCalledAssertion extends AssertionBase {
  type: "toolCalled";
  name: string;
  /** Partial match: every key given must deep-equal the call's argument. */
  args?: Record<string, unknown>;
  /** Exact number of matching calls. Defaults to "at least once". */
  times?: number;
}

/** The agent never called tool `name` (with arguments matching `args`, if given). */
export interface ToolNotCalledAssertion extends AssertionBase {
  type: "toolNotCalled";
  name: string;
  args?: Record<string, unknown>;
}

/** The agent called these tools in this relative order (other calls may sit between them). */
export interface ToolOrderAssertion extends AssertionBase {
  type: "toolOrder";
  names: string[];
}

/** The agent invoked skill `name`. Detected via `skillDetection` in the config. */
export interface SkillTriggeredAssertion extends AssertionBase {
  type: "skillTriggered";
  name: string;
}

/** The response text matches a regular expression. */
export interface RegexAssertion extends AssertionBase {
  type: "regex";
  pattern: string;
  flags?: string;
}

/** A named check function registered in `checks`, e.g. to inspect database state. */
export interface CheckAssertion extends AssertionBase {
  type: "check";
  name: string;
  params?: Record<string, unknown>;
}

export type Assertion =
  | ToolCalledAssertion
  | ToolNotCalledAssertion
  | ToolOrderAssertion
  | SkillTriggeredAssertion
  | RegexAssertion
  | CheckAssertion;

/**
 * The outcome of a single assertion.
 */
export interface AssertionResult {
  assertion: Assertion;
  /** The assertion's description, or a generated label. */
  label: string;
  passed: boolean;
  required: boolean;
  message: string;
}

/**
 * What a check function returns: a boolean, or a verdict with an explanation.
 */
export type CheckOutcome = boolean | { passed: boolean; message?: string };

/**
 * A deterministic check registered by name and referenced from test cases.
 * Runs after the agent answers and before `afterEach`, so it can inspect state
 * the agent changed (a database, files, an API).
 */
export type CheckFunction = (input: {
  run: AgentRun;
  testCase: TestCase;
  params?: Record<string, unknown>;
}) => CheckOutcome | Promise<CheckOutcome>;

/**
 * How a skill invocation shows up in the tool-call trace: a call to `toolName`
 * whose `argKey` argument is the skill's name.
 */
export interface SkillDetection {
  toolName: string;
  argKey: string;
}

export interface TestCase {
  id: string;
  category: string;
  question: string;
  expectedCriteria: string[];
  keywords: string[];
  minResponseLength: number;
  /** Deterministic assertions on the agent's run. */
  assertions?: Assertion[];
}

/**
 * A test case as written in test-cases.json. `expectedCriteria` and `keywords`
 * default to `[]`, `minResponseLength` to `0`, and `category` to `"general"`.
 */
export type TestCaseInput = Omit<
  TestCase,
  "category" | "expectedCriteria" | "keywords" | "minResponseLength"
> &
  Partial<Pick<TestCase, "category" | "expectedCriteria" | "keywords" | "minResponseLength">>;

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
  /** The test case's minimum response length, recorded for the report. */
  minResponseLength?: number;
  /** Results of the test case's deterministic assertions, if it has any. */
  assertionResults?: AssertionResult[];
  /** The agent's tool-call trace, if it reported one. */
  toolCalls?: ToolCall[];
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
  /** Labels of assertions that passed in the baseline but fail now. */
  assertionRegressions?: string[];
}

export interface ScoringWeights {
  criteria: number;
  keywords: number;
  length: number;
  /**
   * Weight for assertions with `required: false`. Only applies to test cases
   * that have such assertions; weights are then normalized to sum to one.
   * Defaults to 0.3.
   */
  assertions?: number;
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
   * Required unless `structuredJudge` is set, or no test case has `expectedCriteria`.
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
  /** Check functions referenced by `{ "type": "check", "name": ... }` assertions. */
  checks?: Record<string, CheckFunction>;
  /** How to recognize skill invocations. Defaults to `{ toolName: "Skill", argKey: "skill" }`. */
  skillDetection?: SkillDetection;
}

export interface RunnerConfig extends EvaluationConfig {
  agent: AgentFunction | TracedAgentFunction;
  /** Runs before each test case, e.g. to seed a database. A throw fails that test case. */
  beforeEach?: (testCase: TestCase) => void | Promise<void>;
  /**
   * Runs after each test case is evaluated, e.g. to reset a database. Runs even
   * when the agent or evaluation throws. A throw fails that test case.
   */
  afterEach?: (testCase: TestCase, result: EvaluationResult) => void | Promise<void>;
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
  skillDetection?: SkillDetection;
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
