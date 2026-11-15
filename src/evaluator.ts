import { evaluateAssertions } from "./assertions.js";
import { DEFAULT_EVALUATION_PROMPT_JA, buildEvaluationPrompt } from "./prompts.js";
import { withRetry } from "./retry.js";
import type {
  AgentRun,
  ComparisonResult,
  CriterionResult,
  EvaluationConfig,
  EvaluationResult,
  ScoringWeights,
  TestCase,
} from "./types.js";

const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  criteria: 0.6,
  keywords: 0.3,
  length: 0.1,
};

const DEFAULT_ASSERTIONS_WEIGHT = 0.3;

/**
 * Evaluates an agent's response against a test case: LLM-as-judge criteria,
 * keyword matching, length, and deterministic assertions.
 *
 * `response` may be the plain text or an AgentRun carrying a tool-call trace.
 */
export async function evaluateResponse(
  testCase: TestCase,
  response: string | AgentRun,
  config: EvaluationConfig,
): Promise<EvaluationResult> {
  const startTime = Date.now();
  const run = toAgentRun(response);
  const text = run.text;
  const weights = config.scoringWeights ?? DEFAULT_SCORING_WEIGHTS;
  const passThreshold = config.passThreshold ?? 0.7;

  // Basic checks
  const responseLength = text.length;
  const lengthCheck = responseLength >= testCase.minResponseLength;

  // Keyword matching
  const keywordMatches = testCase.keywords.map((keyword) => ({
    keyword,
    found: text.includes(keyword),
  }));

  // Deterministic assertions
  const assertionResults = testCase.assertions?.length
    ? await evaluateAssertions(testCase.assertions, run, testCase, {
        checks: config.checks,
        skillDetection: config.skillDetection,
      })
    : undefined;

  // LLM-as-judge evaluation for criteria
  const criteriaResults =
    testCase.expectedCriteria.length > 0
      ? await evaluateCriteria(testCase.question, text, testCase.expectedCriteria, config)
      : [];

  // Calculate overall score. An empty criteria or keyword list is vacuously met.
  const criteriaScore = fraction(criteriaResults.filter((r) => r.met).length, criteriaResults.length);
  const keywordScore = fraction(keywordMatches.filter((k) => k.found).length, keywordMatches.length);
  const lengthScore = lengthCheck ? 1 : 0;

  let totalScore =
    criteriaScore * weights.criteria +
    keywordScore * weights.keywords +
    lengthScore * weights.length;

  // Non-required assertions add a weighted component; weights are then normalized.
  const scoredAssertions = assertionResults?.filter((a) => !a.required) ?? [];
  if (scoredAssertions.length > 0) {
    const assertionsWeight = weights.assertions ?? DEFAULT_ASSERTIONS_WEIGHT;
    const assertionScore = fraction(
      scoredAssertions.filter((a) => a.passed).length,
      scoredAssertions.length,
    );
    const totalWeight = weights.criteria + weights.keywords + weights.length + assertionsWeight;
    totalScore =
      totalWeight > 0 ? (totalScore + assertionScore * assertionsWeight) / totalWeight : 0;
  }

  const requiredAssertionsPassed =
    assertionResults?.every((a) => !a.required || a.passed) ?? true;
  const passed = totalScore >= passThreshold && requiredAssertionsPassed;
  const evaluationTime = Date.now() - startTime;

  return {
    testId: testCase.id,
    question: testCase.question,
    response: text,
    passed,
    score: totalScore,
    criteriaResults,
    keywordMatches,
    responseLength,
    minResponseLength: testCase.minResponseLength,
    ...(assertionResults ? { assertionResults } : {}),
    ...(run.toolCalls ? { toolCalls: run.toolCalls } : {}),
    evaluationTime,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Normalizes an agent's return value to an AgentRun.
 */
export function toAgentRun(response: string | AgentRun): AgentRun {
  return typeof response === "string" ? { text: response } : response;
}

function fraction(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

/**
 * Uses LLM-as-judge to evaluate if criteria are met.
 *
 * Delegates to config.structuredJudge when set — one call for all criteria —
 * and otherwise falls back to the per-criterion text prompt.
 */
async function evaluateCriteria(
  question: string,
  response: string,
  criteria: string[],
  config: EvaluationConfig,
): Promise<CriterionResult[]> {
  if (config.structuredJudge) {
    return evaluateCriteriaStructured(question, response, criteria, config);
  }
  if (!config.evaluationLLM) {
    throw new Error(
      "EvaluationConfig requires either evaluationLLM or structuredJudge",
    );
  }
  return evaluateCriteriaWithPrompts(question, response, criteria, config);
}

/**
 * Evaluates all criteria in a single structured-judge call.
 */
async function evaluateCriteriaStructured(
  question: string,
  response: string,
  criteria: string[],
  config: EvaluationConfig,
): Promise<CriterionResult[]> {
  const judge = config.structuredJudge;
  if (!judge) {
    throw new Error("evaluateCriteriaStructured called without a structuredJudge");
  }

  try {
    const verdicts = await withRetry(
      () => judge({ question, response, criteria }),
      config.retryConfig,
    );

    if (verdicts.length !== criteria.length) {
      throw new Error(
        `structuredJudge returned ${verdicts.length} verdict(s) for ${criteria.length} criteria`,
      );
    }

    return criteria.map((criterion, i) => {
      const verdict = verdicts[i];
      return {
        criterion,
        met: verdict.met,
        reasoning: verdict.reasoning ?? describeConfidence(verdict.confidence),
        ...(verdict.confidence === undefined
          ? {}
          : { confidence: verdict.confidence }),
      };
    });
  } catch (error) {
    console.error("Error evaluating criteria with structured judge", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return criteria.map((criterion) => ({
      criterion,
      met: false,
      reasoning: `Evaluation error: ${message}`,
    }));
  }
}

/**
 * Describes a verdict that carries no reasoning text of its own.
 */
function describeConfidence(confidence: number | undefined): string {
  return confidence === undefined
    ? "Evaluation reasoning not available"
    : `Judge confidence: ${(confidence * 100).toFixed(1)}%`;
}

/**
 * Evaluates each criterion with its own rendered text prompt.
 */
async function evaluateCriteriaWithPrompts(
  question: string,
  response: string,
  criteria: string[],
  config: EvaluationConfig,
): Promise<CriterionResult[]> {
  const evaluationLLM = config.evaluationLLM;
  if (!evaluationLLM) {
    throw new Error("evaluateCriteriaWithPrompts called without an evaluationLLM");
  }
  const template = config.evaluationPromptTemplate ?? DEFAULT_EVALUATION_PROMPT_JA;
  const interCallDelay = config.interCallDelay ?? 500;

  const results = [];
  for (const criterion of criteria) {
    const result = await (async () => {
      const prompt = buildEvaluationPrompt(template, {
        question,
        response,
        criterion,
      });

      try {
        const text = await withRetry(
          () => evaluationLLM(prompt),
          config.retryConfig,
        );

        const metMatch = text.match(/MET:\s*(YES|NO)/i);
        const reasoningMatch = text.match(/REASONING:\s*([\s\S]+)/i);

        return {
          criterion,
          met: metMatch?.[1]?.toUpperCase() === "YES",
          reasoning:
            reasoningMatch?.[1]?.trim() || "Evaluation reasoning not available",
        };
      } catch (error) {
        console.error(`Error evaluating criterion: ${criterion}`, error);
        return {
          criterion,
          met: false,
          reasoning: `Evaluation error: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        };
      }
    })();
    results.push(result);

    // Add delay between API calls to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, interCallDelay));
  }

  return results;
}

/**
 * Compares current results with baseline
 */
export function compareWithBaseline(
  current: EvaluationResult[],
  baseline: EvaluationResult[],
  regressionThreshold = 0.2,
): ComparisonResult[] {
  const comparisons: ComparisonResult[] = [];

  for (const currentResult of current) {
    const baselineResult = baseline.find(
      (b) => b.testId === currentResult.testId,
    );

    if (!baselineResult) {
      console.warn(
        `No baseline found for test: ${currentResult.testId}. Skipping comparison.`,
      );
      continue;
    }

    const delta = currentResult.score - baselineResult.score;
    const assertionRegressions = findAssertionRegressions(currentResult, baselineResult);
    const regression = delta < -regressionThreshold || assertionRegressions.length > 0;
    const improvement = delta > regressionThreshold;

    comparisons.push({
      testId: currentResult.testId,
      baselineScore: baselineResult.score,
      currentScore: currentResult.score,
      delta,
      regression,
      improvement,
      ...(assertionRegressions.length > 0 ? { assertionRegressions } : {}),
    });
  }

  return comparisons;
}

/**
 * Labels of assertions that passed in the baseline and fail now. Assertions are
 * matched by label; ones missing from either side are ignored.
 */
function findAssertionRegressions(
  current: EvaluationResult,
  baseline: EvaluationResult,
): string[] {
  if (!current.assertionResults || !baseline.assertionResults) return [];
  const passedBefore = new Set(
    baseline.assertionResults.filter((a) => a.passed).map((a) => a.label),
  );
  return current.assertionResults
    .filter((a) => !a.passed && passedBefore.has(a.label))
    .map((a) => a.label);
}

/**
 * Generates a summary report
 */
export function generateReport(
  results: EvaluationResult[],
  comparisons?: ComparisonResult[],
): string {
  const totalTests = results.length;
  const passedTests = results.filter((r) => r.passed).length;
  const averageScore =
    results.reduce((sum, r) => sum + r.score, 0) / totalTests;

  let report = `
# Agent Regression Test Report
Generated: ${new Date().toISOString()}

## Summary
- Total Tests: ${totalTests}
- Passed: ${passedTests}
- Failed: ${totalTests - passedTests}
- Pass Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%
- Average Score: ${(averageScore * 100).toFixed(1)}%

## Detailed Results
`;

  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    report += `
### ${status} ${result.testId} (Score: ${(result.score * 100).toFixed(1)}%)
**Question:** ${result.question}

**Response:**
\`\`\`
${result.response || "(No response generated)"}
\`\`\`

**Criteria Results:**
`;
    for (const cr of result.criteriaResults) {
      const criterionStatus = mark(cr.met);
      report += `- ${criterionStatus} ${cr.criterion}\n  _${cr.reasoning}_\n`;
    }

    if (result.assertionResults && result.assertionResults.length > 0) {
      report += `\n**Assertions:**\n`;
      for (const ar of result.assertionResults) {
        const assertionStatus = mark(ar.passed);
        const optional = ar.required ? "" : " (optional)";
        report += `- ${assertionStatus} ${ar.label}${optional}\n  _${ar.message}_\n`;
      }
    }

    report += `\n**Keywords:** ${result.keywordMatches
      .map((k) => `${mark(k.found)} ${k.keyword}`)
      .join(", ")}
**Response Length:** ${result.responseLength} chars${formatLengthCheck(result)}
---
`;
  }

  if (comparisons && comparisons.length > 0) {
    const regressions = comparisons.filter((c) => c.regression);
    const improvements = comparisons.filter((c) => c.improvement);

    report += `
## Comparison with Baseline
- Regressions: ${regressions.length}
- Improvements: ${improvements.length}
- Stable: ${comparisons.length - regressions.length - improvements.length}

`;

    if (regressions.length > 0) {
      report += `### Regressions Detected:\n`;
      for (const reg of regressions) {
        report += `- ${reg.testId}: ${formatPercent(reg.baselineScore)}% -> ${formatPercent(
          reg.currentScore,
        )}% (${formatPercent(reg.delta)}%)\n`;
        for (const label of reg.assertionRegressions ?? []) {
          report += `  - assertion now failing: ${label}\n`;
        }
      }
    }

    if (improvements.length > 0) {
      report += `\n### Improvements:\n`;
      for (const imp of improvements) {
        report += `- ${imp.testId}: ${formatPercent(imp.baselineScore)}% -> ${formatPercent(
          imp.currentScore,
        )}% (+${formatPercent(imp.delta)}%)\n`;
      }
    }
  }

  return report;
}

/**
 * Formats a 0..1 ratio as a percentage with one decimal, without printing
 * "-0.0" for tiny negative floating-point deltas.
 */
function formatPercent(ratio: number): string {
  const formatted = (ratio * 100).toFixed(1);
  return formatted === "-0.0" ? "0.0" : formatted;
}

/**
 * The report's length verdict. Results saved before minResponseLength was
 * recorded show only the length.
 */
function formatLengthCheck(result: EvaluationResult): string {
  if (result.minResponseLength === undefined) return "";
  const met = result.responseLength >= result.minResponseLength;
  return ` (min: ${result.minResponseLength}, ${met ? "met" : "not met"})`;
}

/**
 * Pass/fail marker for report lines. Emoji rather than "+"/"-", which
 * Markdown would read as list bullets and drop when the report is rendered.
 */
function mark(passed: boolean): string {
  return passed ? "✅" : "❌";
}
