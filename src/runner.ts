import fs from "node:fs/promises";
import path from "node:path";
import {
  compareWithBaseline,
  evaluateResponse,
  generateReport,
  toAgentRun,
} from "./evaluator.js";
import { assertionLabel } from "./assertions.js";
import { writeDashboard } from "./dashboard.js";
import { withRetry } from "./retry.js";
import type { EvaluationResult, RunnerConfig, TestCase } from "./types.js";

/**
 * Main test runner for agent regression testing.
 */
export async function runTests(config: RunnerConfig): Promise<{
  results: EvaluationResult[];
  report: string;
  exitCode: number;
}> {
  console.log("Starting agent regression tests...\n");

  const { testCases, agent, baseline } = config;
  console.log(`Loaded ${testCases.length} test cases\n`);

  // Run tests
  const results: EvaluationResult[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(
      `[${i + 1}/${testCases.length}] Testing: ${testCase.id} (${testCase.category})`,
    );

    let result: EvaluationResult | undefined;
    try {
      await config.beforeEach?.(testCase);
    } catch (error) {
      result = failedResult(testCase, error, "beforeEach");
    }

    if (!result) {
      try {
        const output = await withRetry(
          () => agent(testCase.question, { testCase }),
          config.retryConfig,
        );
        result = await evaluateResponse(testCase, toAgentRun(output), config);
        const status = result.passed ? "PASS" : "FAIL";
        console.log(
          `  ${status} Score: ${(result.score * 100).toFixed(1)}% (${result.evaluationTime}ms)\n`,
        );
      } catch (error) {
        result = failedResult(testCase, error);
      }
    }

    if (config.afterEach) {
      try {
        await config.afterEach(testCase, result);
      } catch (error) {
        result = failedResult(testCase, error, "afterEach");
      }
    }
    results.push(result);
  }

  // Compare with baseline if provided
  let comparisons;
  if (baseline) {
    console.log("\nComparing with baseline...");
    comparisons = compareWithBaseline(
      results,
      baseline,
      config.regressionThreshold,
    );

    const regressions = comparisons.filter((c) => c.regression).length;
    if (regressions > 0) {
      console.log(`${regressions} regression(s) detected!\n`);
    } else {
      console.log("No regressions detected\n");
    }
  }

  // Generate report
  const report = generateReport(results, comparisons);

  // Save results if requested
  if (config.saveResults !== false && config.outputDir) {
    const outputPath = path.join(
      config.outputDir,
      `results-${Date.now()}.json`,
    );

    await fs.mkdir(config.outputDir, { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${outputPath}\n`);

    const reportPath = outputPath.replace(".json", ".md");
    await fs.writeFile(reportPath, report);
    console.log(`Report saved to: ${reportPath}\n`);

    if (config.dashboard) {
      const dashboardPath = await writeDashboard(config.outputDir);
      console.log(`Dashboard saved to: ${dashboardPath}\n`);
    }
  }

  // Determine exit code
  const hasFailures = results.some((r) => !r.passed);
  const hasRegressions = comparisons?.some((c) => c.regression) || false;
  const exitCode = hasFailures || hasRegressions ? 1 : 0;

  return {
    results,
    report,
    exitCode,
  };
}

/**
 * The result recorded for a test case whose run, evaluation, or hooks threw.
 */
function failedResult(
  testCase: TestCase,
  error: unknown,
  stage?: string,
): EvaluationResult {
  const message = error instanceof Error ? error.message : "Unknown error";
  const reason = stage ? `${stage} failed: ${message}` : "Test execution failed";
  console.error(`  ERROR${stage ? ` in ${stage}` : ""}: ${message}\n`);
  return {
    testId: testCase.id,
    question: testCase.question,
    response: "",
    passed: false,
    score: 0,
    criteriaResults: testCase.expectedCriteria.map((criterion) => ({
      criterion,
      met: false,
      reasoning: reason,
    })),
    keywordMatches: testCase.keywords.map((keyword) => ({
      keyword,
      found: false,
    })),
    responseLength: 0,
    minResponseLength: testCase.minResponseLength,
    ...(testCase.assertions?.length
      ? {
          assertionResults: testCase.assertions.map((assertion) => ({
            assertion,
            label: assertionLabel(assertion),
            passed: false,
            required: assertion.required !== false,
            message: reason,
          })),
        }
      : {}),
    evaluationTime: 0,
    timestamp: new Date().toISOString(),
  };
}
