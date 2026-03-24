import { DEFAULT_EVALUATION_PROMPT_JA, buildEvaluationPrompt } from "./prompts.js";
import { withRetry } from "./retry.js";
import type {
  ComparisonResult,
  EvaluationConfig,
  EvaluationResult,
  TestCase,
} from "./types.js";

const DEFAULT_SCORING_WEIGHTS = {
  criteria: 0.6,
  keywords: 0.3,
  length: 0.1,
};

/**
 * Evaluates if a response meets the expected criteria using LLM-as-judge
 */
export async function evaluateResponse(
  testCase: TestCase,
  response: string,
  config: EvaluationConfig,
): Promise<EvaluationResult> {
  const startTime = Date.now();
  const weights = config.scoringWeights ?? DEFAULT_SCORING_WEIGHTS;
  const passThreshold = config.passThreshold ?? 0.7;

  // Basic checks
  const responseLength = response.length;
  const lengthCheck = responseLength >= testCase.minResponseLength;

  // Keyword matching
  const keywordMatches = testCase.keywords.map((keyword) => ({
    keyword,
    found: response.includes(keyword),
  }));

  // LLM-as-judge evaluation for criteria
  const criteriaResults = await evaluateCriteria(
    testCase.question,
    response,
    testCase.expectedCriteria,
    config,
  );

  // Calculate overall score
  const criteriaScore =
    criteriaResults.filter((r) => r.met).length / criteriaResults.length;
  const keywordScore =
    keywordMatches.filter((k) => k.found).length / keywordMatches.length;
  const lengthScore = lengthCheck ? 1 : 0;

  const totalScore =
    criteriaScore * weights.criteria +
    keywordScore * weights.keywords +
    lengthScore * weights.length;

  const passed = totalScore >= passThreshold;
  const evaluationTime = Date.now() - startTime;

  return {
    testId: testCase.id,
    question: testCase.question,
    response,
    passed,
    score: totalScore,
    criteriaResults,
    keywordMatches,
    responseLength,
    evaluationTime,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Uses LLM-as-judge to evaluate if criteria are met
 */
async function evaluateCriteria(
  question: string,
  response: string,
  criteria: string[],
  config: EvaluationConfig,
): Promise<{ criterion: string; met: boolean; reasoning: string }[]> {
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
          () => config.evaluationLLM(prompt),
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
    const regression = delta < -regressionThreshold;
    const improvement = delta > regressionThreshold;

    comparisons.push({
      testId: currentResult.testId,
      baselineScore: baselineResult.score,
      currentScore: currentResult.score,
      delta,
      regression,
      improvement,
    });
  }

  return comparisons;
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
      const criterionStatus = cr.met ? "+" : "-";
      report += `- ${criterionStatus} ${cr.criterion}\n  _${cr.reasoning}_\n`;
    }

    report += `\n**Keywords:** ${result.keywordMatches
      .map((k) => `${k.keyword}${k.found ? "+" : "-"}`)
      .join(", ")}
**Response Length:** ${result.responseLength} chars (min: ${
      result.responseLength >= 100 ? "met" : "not met"
    })
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
        report += `- ${reg.testId}: ${(reg.baselineScore * 100).toFixed(
          1,
        )}% -> ${(reg.currentScore * 100).toFixed(1)}% (${(
          reg.delta * 100
        ).toFixed(1)}%)\n`;
      }
    }

    if (improvements.length > 0) {
      report += `\n### Improvements:\n`;
      for (const imp of improvements) {
        report += `- ${imp.testId}: ${(imp.baselineScore * 100).toFixed(
          1,
        )}% -> ${(imp.currentScore * 100).toFixed(1)}% (+${(
          imp.delta * 100
        ).toFixed(1)}%)\n`;
      }
    }
  }

  return report;
}
