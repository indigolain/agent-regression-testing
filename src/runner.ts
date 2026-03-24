import fs from "node:fs/promises";
import path from "node:path";
import { compareWithBaseline, evaluateResponse, generateReport } from "./evaluator.js";
import { withRetry } from "./retry.js";
import type { EvaluationResult, RunnerConfig } from "./types.js";

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

    try {
      const responseText = await withRetry(
        () => agent(testCase.question),
        config.retryConfig,
      );

      const result = await evaluateResponse(testCase, responseText, config);
      results.push(result);

      const status = result.passed ? "PASS" : "FAIL";
      console.log(
        `  ${status} Score: ${(result.score * 100).toFixed(1)}% (${result.evaluationTime}ms)\n`,
      );
    } catch (error) {
      console.error(
        `  ERROR: ${error instanceof Error ? error.message : "Unknown error"}\n`,
      );
      results.push({
        testId: testCase.id,
        question: testCase.question,
        response: "",
        passed: false,
        score: 0,
        criteriaResults: testCase.expectedCriteria.map((criterion) => ({
          criterion,
          met: false,
          reasoning: "Test execution failed",
        })),
        keywordMatches: testCase.keywords.map((keyword) => ({
          keyword,
          found: false,
        })),
        responseLength: 0,
        evaluationTime: 0,
        timestamp: new Date().toISOString(),
      });
    }
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
