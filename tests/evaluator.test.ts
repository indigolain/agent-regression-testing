import { describe, expect, it, vi } from "vitest";
import {
  compareWithBaseline,
  evaluateResponse,
  generateReport,
} from "../src/evaluator.js";
import type {
  ComparisonResult,
  CriterionVerdict,
  EvaluationConfig,
  EvaluationResult,
  StructuredJudge,
  TestCase,
} from "../src/types.js";

const makeTestCase = (overrides?: Partial<TestCase>): TestCase => ({
  id: "test-1",
  category: "react",
  question: "How do I handle form validation in React?",
  expectedCriteria: ["Explains controlled components", "Mentions error state handling"],
  keywords: ["useState", "onChange"],
  minResponseLength: 20,
  ...overrides,
});

const makeConfig = (
  llmResponse: string | string[],
  overrides?: Partial<EvaluationConfig>,
): EvaluationConfig => {
  const responses = Array.isArray(llmResponse) ? [...llmResponse] : [];
  let callIndex = 0;

  return {
    evaluationLLM: vi.fn(async () => {
      if (Array.isArray(llmResponse)) {
        return responses[callIndex++] ?? "";
      }
      return llmResponse;
    }),
    interCallDelay: 0,
    retryConfig: { maxRetries: 1, initialDelay: 0, backoffMultiplier: 1, retryOnStatusCodes: [429] },
    ...overrides,
  };
};

const makeResult = (overrides?: Partial<EvaluationResult>): EvaluationResult => ({
  testId: "test-1",
  question: "How do I handle form validation in React?",
  response: "Use useState to track input values and validate onChange. Display errors with conditional rendering.",
  passed: true,
  score: 0.9,
  criteriaResults: [{ criterion: "c1", met: true, reasoning: "good" }],
  keywordMatches: [{ keyword: "useState", found: true }],
  responseLength: 90,
  evaluationTime: 100,
  timestamp: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("evaluateResponse", () => {
  it("returns a passing result when all criteria and keywords are met", async () => {
    const testCase = makeTestCase();
    const response =
      "Use useState to track each field value and validate on onChange. Show error messages conditionally based on validation state.";
    const config = makeConfig("MET: YES\nREASONING: The response clearly addresses this.");

    const result = await evaluateResponse(testCase, response, config);

    expect(result.testId).toBe("test-1");
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0.7);
    expect(result.criteriaResults).toHaveLength(2);
    expect(result.criteriaResults.every((c) => c.met)).toBe(true);
    expect(result.keywordMatches).toEqual([
      { keyword: "useState", found: true },
      { keyword: "onChange", found: true },
    ]);
    expect(result.responseLength).toBe(response.length);
    expect(result.timestamp).toBeTruthy();
  });

  it("returns a failing result when criteria are not met", async () => {
    const testCase = makeTestCase({
      question: "How do I set up SSR with Next.js?",
      expectedCriteria: ["Explains getServerSideProps", "Mentions data fetching on each request"],
      keywords: ["getServerSideProps", "SSR"],
    });
    const response = "Next.js supports getServerSideProps for SSR rendering.";
    const config = makeConfig("MET: NO\nREASONING: Not sufficient.");

    const result = await evaluateResponse(testCase, response, config);

    expect(result.passed).toBe(false);
    expect(result.criteriaResults.every((c) => !c.met)).toBe(true);
  });

  it("uses custom scoring weights", async () => {
    const testCase = makeTestCase({
      question: "What is the virtual DOM?",
      expectedCriteria: ["Explains diffing algorithm"],
      keywords: ["nonexistent"],
      minResponseLength: 9999,
    });
    const response = "Short";
    const config = makeConfig("MET: YES\nREASONING: Ok", {
      scoringWeights: { criteria: 1.0, keywords: 0.0, length: 0.0 },
      passThreshold: 0.7,
    });

    const result = await evaluateResponse(testCase, response, config);

    // All criteria met (weight 1.0), keywords missed (weight 0), length missed (weight 0)
    expect(result.score).toBe(1.0);
    expect(result.passed).toBe(true);
  });

  it("uses custom pass threshold", async () => {
    const testCase = makeTestCase({
      question: "How do I configure CORS in Express?",
      expectedCriteria: ["Shows middleware usage", "Mentions allowed origins"],
      keywords: ["cors", "app.use"],
    });
    // Use exact keyword casing (case-sensitive includes)
    const response = "Install the cors package and add app.use(cors({ origin })) to configure allowed origins.";
    const config = makeConfig("MET: YES\nREASONING: Ok", {
      passThreshold: 0.99,
    });

    const result = await evaluateResponse(testCase, response, config);

    // Score is 1.0 (all criteria met, all keywords found, length met)
    expect(result.score).toBeCloseTo(1.0, 5);
    expect(result.passed).toBe(true);
  });

  it("handles LLM errors gracefully", async () => {
    const testCase = makeTestCase({
      question: "How do I optimize a webpack bundle?",
      expectedCriteria: ["Mentions code splitting", "Mentions tree shaking"],
      keywords: ["webpack", "bundle"],
    });
    const response = "Use webpack code splitting and tree shaking to reduce bundle size.";
    const config = makeConfig("", {
      evaluationLLM: vi.fn().mockRejectedValue(new Error("LLM down")),
      retryConfig: { maxRetries: 1, initialDelay: 0, backoffMultiplier: 1, retryOnStatusCodes: [] },
    });

    const result = await evaluateResponse(testCase, response, config);

    expect(result.criteriaResults.every((c) => !c.met)).toBe(true);
    expect(result.criteriaResults[0].reasoning).toContain("LLM down");
  });

  it("parses mixed YES/NO criteria responses", async () => {
    const testCase = makeTestCase({
      question: "How do I implement authentication with JWT?",
      expectedCriteria: ["Explains token signing", "Mentions refresh tokens"],
      keywords: ["JWT", "token"],
    });
    const response = "Sign a JWT token on login using a secret key and send it in the Authorization header.";
    const config = makeConfig([
      "MET: YES\nREASONING: Clearly explains signing process.",
      "MET: NO\nREASONING: Does not mention refresh tokens.",
    ]);

    const result = await evaluateResponse(testCase, response, config);

    expect(result.criteriaResults[0].met).toBe(true);
    expect(result.criteriaResults[1].met).toBe(false);
    // criteria: 0.5*0.6=0.3, keywords: 1.0*0.3=0.3, length: 1*0.1=0.1 => 0.7
    expect(result.score).toBeCloseTo(0.7, 5);
    expect(result.passed).toBe(true);
  });

  it("uses custom evaluation prompt template", async () => {
    const testCase = makeTestCase({
      question: "How do I deploy to Vercel?",
      expectedCriteria: ["Covers CLI deployment"],
      keywords: ["vercel"],
    });
    const response = "Run vercel deploy from your project root.";
    const capturedPrompts: string[] = [];
    const config = makeConfig("", {
      evaluationPromptTemplate:
        "Custom: {{question}} | {{response}} | {{criterion}}",
      evaluationLLM: vi.fn(async (prompt: string) => {
        capturedPrompts.push(prompt);
        return "MET: YES\nREASONING: Fine.";
      }),
    });

    await evaluateResponse(testCase, response, config);

    expect(capturedPrompts[0]).toBe(
      "Custom: How do I deploy to Vercel? | Run vercel deploy from your project root. | Covers CLI deployment",
    );
  });
});

describe("evaluateResponse with structuredJudge", () => {
  const makeJudgeConfig = (
    judge: StructuredJudge,
    overrides?: Partial<EvaluationConfig>,
  ): EvaluationConfig => ({
    structuredJudge: judge,
    retryConfig: { maxRetries: 1, initialDelay: 0, backoffMultiplier: 1, retryOnStatusCodes: [] },
    ...overrides,
  });

  it("evaluates all criteria in a single call", async () => {
    const testCase = makeTestCase();
    const response =
      "Use useState to track each field value and validate on onChange. Show error messages conditionally.";
    const judge = vi.fn(async () => [
      { met: true, reasoning: "Covers controlled inputs." },
      { met: true, reasoning: "Covers error state." },
    ]);
    const config = makeJudgeConfig(judge);

    const result = await evaluateResponse(testCase, response, config);

    expect(judge).toHaveBeenCalledTimes(1);
    expect(judge).toHaveBeenCalledWith({
      question: testCase.question,
      response,
      criteria: testCase.expectedCriteria,
    });
    expect(result.criteriaResults).toEqual([
      {
        criterion: "Explains controlled components",
        met: true,
        reasoning: "Covers controlled inputs.",
      },
      {
        criterion: "Mentions error state handling",
        met: true,
        reasoning: "Covers error state.",
      },
    ]);
    expect(result.passed).toBe(true);
  });

  it("keeps confidence and derives reasoning when the judge omits it", async () => {
    const testCase = makeTestCase();
    const response = "Use useState and handle onChange validation errors.";
    const verdicts: CriterionVerdict[] = [
      { met: true, confidence: 0.912 },
      { met: false, confidence: 0.4 },
    ];
    const config = makeJudgeConfig(vi.fn(async () => verdicts));

    const result = await evaluateResponse(testCase, response, config);

    expect(result.criteriaResults[0].confidence).toBe(0.912);
    expect(result.criteriaResults[0].reasoning).toBe("Judge confidence: 91.2%");
    expect(result.criteriaResults[1].met).toBe(false);
    expect(result.criteriaResults[1].reasoning).toBe("Judge confidence: 40.0%");
  });

  it("takes precedence over evaluationLLM when both are set", async () => {
    const testCase = makeTestCase({ expectedCriteria: ["Explains hooks"] });
    const evaluationLLM = vi.fn(async () => "MET: NO\nREASONING: Should not run.");
    const config = makeJudgeConfig(vi.fn(async () => [{ met: true, reasoning: "From judge." }]), {
      evaluationLLM,
    });

    const result = await evaluateResponse(testCase, "Use useState for state.", config);

    expect(evaluationLLM).not.toHaveBeenCalled();
    expect(result.criteriaResults[0].reasoning).toBe("From judge.");
  });

  it("fails every criterion when the judge throws", async () => {
    const testCase = makeTestCase();
    const config = makeJudgeConfig(vi.fn().mockRejectedValue(new Error("Jev unreachable")));

    const result = await evaluateResponse(testCase, "Some response text here.", config);

    expect(result.criteriaResults).toHaveLength(2);
    expect(result.criteriaResults.every((c) => !c.met)).toBe(true);
    expect(result.criteriaResults[0].reasoning).toContain("Jev unreachable");
  });

  it("fails every criterion when the judge returns a mismatched verdict count", async () => {
    const testCase = makeTestCase();
    const config = makeJudgeConfig(vi.fn(async () => [{ met: true }]));

    const result = await evaluateResponse(testCase, "Some response text here.", config);

    expect(result.criteriaResults.every((c) => !c.met)).toBe(true);
    expect(result.criteriaResults[0].reasoning).toContain(
      "returned 1 verdict(s) for 2 criteria",
    );
  });

  it("throws when neither judge is configured", async () => {
    const testCase = makeTestCase();
    const config = { interCallDelay: 0 } as EvaluationConfig;

    await expect(
      evaluateResponse(testCase, "Some response text here.", config),
    ).rejects.toThrow("requires either evaluationLLM or structuredJudge");
  });
});

describe("compareWithBaseline", () => {
  it("detects regression when score drops significantly", () => {
    const current = [makeResult({ testId: "api-routes", score: 0.4 })];
    const baseline = [makeResult({ testId: "api-routes", score: 0.9 })];

    const comparisons = compareWithBaseline(current, baseline);

    expect(comparisons).toHaveLength(1);
    expect(comparisons[0].regression).toBe(true);
    expect(comparisons[0].improvement).toBe(false);
    expect(comparisons[0].delta).toBeCloseTo(-0.5, 5);
  });

  it("detects improvement when score increases significantly", () => {
    const current = [makeResult({ testId: "css-grid", score: 0.95 })];
    const baseline = [makeResult({ testId: "css-grid", score: 0.5 })];

    const comparisons = compareWithBaseline(current, baseline);

    expect(comparisons[0].improvement).toBe(true);
    expect(comparisons[0].regression).toBe(false);
  });

  it("reports stable when delta is within threshold", () => {
    const current = [makeResult({ testId: "typescript-generics", score: 0.85 })];
    const baseline = [makeResult({ testId: "typescript-generics", score: 0.9 })];

    const comparisons = compareWithBaseline(current, baseline);

    expect(comparisons[0].regression).toBe(false);
    expect(comparisons[0].improvement).toBe(false);
  });

  it("uses custom regression threshold", () => {
    const current = [makeResult({ testId: "react-hooks", score: 0.8 })];
    const baseline = [makeResult({ testId: "react-hooks", score: 0.9 })];

    // With default threshold (0.2), this is stable
    expect(compareWithBaseline(current, baseline)[0].regression).toBe(false);

    // With a tighter threshold (0.05), this is a regression
    expect(compareWithBaseline(current, baseline, 0.05)[0].regression).toBe(true);
  });

  it("skips tests not found in baseline", () => {
    const current = [
      makeResult({ testId: "nextjs-ssr", score: 0.9 }),
      makeResult({ testId: "new-prisma-test", score: 0.5 }),
    ];
    const baseline = [makeResult({ testId: "nextjs-ssr", score: 0.9 })];

    const comparisons = compareWithBaseline(current, baseline);

    expect(comparisons).toHaveLength(1);
    expect(comparisons[0].testId).toBe("nextjs-ssr");
  });

  it("handles empty inputs", () => {
    expect(compareWithBaseline([], [])).toEqual([]);
    expect(compareWithBaseline([], [makeResult()])).toEqual([]);
  });
});

describe("generateReport", () => {
  it("includes summary statistics", () => {
    const results = [
      makeResult({ testId: "react-forms", passed: true, score: 0.9 }),
      makeResult({ testId: "express-middleware", passed: false, score: 0.4 }),
    ];

    const report = generateReport(results);

    expect(report).toContain("Total Tests: 2");
    expect(report).toContain("Passed: 1");
    expect(report).toContain("Failed: 1");
    expect(report).toContain("Pass Rate: 50.0%");
    expect(report).toContain("Average Score: 65.0%");
  });

  it("includes detailed results for each test", () => {
    const results = [
      makeResult({
        testId: "docker-compose",
        question: "How do I set up Docker Compose for a Node.js app?",
        response: "Create a docker-compose.yml with service definitions for your app and database.",
        passed: true,
        score: 0.85,
      }),
    ];

    const report = generateReport(results);

    expect(report).toContain("PASS docker-compose");
    expect(report).toContain("85.0%");
    expect(report).toContain("How do I set up Docker Compose for a Node.js app?");
    expect(report).toContain("docker-compose.yml");
  });

  it("includes comparison section when provided", () => {
    const results = [makeResult({ testId: "graphql-resolvers" })];
    const comparisons: ComparisonResult[] = [
      {
        testId: "graphql-resolvers",
        baselineScore: 0.9,
        currentScore: 0.5,
        delta: -0.4,
        regression: true,
        improvement: false,
      },
    ];

    const report = generateReport(results, comparisons);

    expect(report).toContain("Comparison with Baseline");
    expect(report).toContain("Regressions: 1");
    expect(report).toContain("Regressions Detected");
    expect(report).toContain("graphql-resolvers");
  });

  it("includes improvements in comparison section", () => {
    const results = [makeResult({ testId: "rest-api-design" })];
    const comparisons: ComparisonResult[] = [
      {
        testId: "rest-api-design",
        baselineScore: 0.5,
        currentScore: 0.9,
        delta: 0.4,
        regression: false,
        improvement: true,
      },
    ];

    const report = generateReport(results, comparisons);

    expect(report).toContain("Improvements: 1");
    expect(report).toContain("Improvements:");
  });

  it("omits comparison section when not provided", () => {
    const results = [makeResult()];
    const report = generateReport(results);

    expect(report).not.toContain("Comparison with Baseline");
  });
});

describe("evaluateResponse with assertions", () => {
  const traced = {
    text: "Refund issued for order 123.",
    toolCalls: [{ name: "issue_refund", args: { orderId: "123" } }],
  };

  it("accepts an AgentRun and records assertion results and the trace", async () => {
    const testCase = makeTestCase({
      expectedCriteria: [],
      keywords: [],
      minResponseLength: 0,
      assertions: [{ type: "toolCalled", name: "issue_refund", args: { orderId: "123" } }],
    });
    const config = makeConfig("unused");

    const result = await evaluateResponse(testCase, traced, config);

    expect(result.response).toBe(traced.text);
    expect(result.toolCalls).toEqual(traced.toolCalls);
    expect(result.assertionResults).toHaveLength(1);
    expect(result.assertionResults?.[0].passed).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.score).toBeCloseTo(1);
  });

  it("fails the test when a required assertion fails, whatever the score", async () => {
    const testCase = makeTestCase({
      assertions: [{ type: "toolNotCalled", name: "issue_refund" }],
    });
    const config = makeConfig("MET: YES\nREASONING: ok");
    const result = await evaluateResponse(
      testCase,
      { ...traced, text: "useState onChange useState onChange" },
      config,
    );

    expect(result.score).toBeCloseTo(1);
    expect(result.passed).toBe(false);
  });

  it("scores optional assertions with the assertions weight, normalized", async () => {
    const testCase = makeTestCase({
      expectedCriteria: [],
      keywords: [],
      minResponseLength: 0,
      assertions: [
        { type: "toolCalled", name: "issue_refund", required: false },
        { type: "toolCalled", name: "notify", required: false },
      ],
    });
    const config = makeConfig("unused", {
      scoringWeights: { criteria: 0.6, keywords: 0.3, length: 0.1, assertions: 1 },
    });

    const result = await evaluateResponse(testCase, traced, config);

    // (1.0 base + 0.5 * 1) / 2
    expect(result.score).toBeCloseTo(0.75);
    expect(result.passed).toBe(true);
  });

  it("does not call the judge when there are no criteria", async () => {
    const testCase = makeTestCase({ expectedCriteria: [] });
    const config = makeConfig("MET: YES");

    const result = await evaluateResponse(testCase, "useState onChange", config);

    expect(config.evaluationLLM).not.toHaveBeenCalled();
    expect(result.criteriaResults).toEqual([]);
  });

  it("needs no judge at all for a deterministic-only test case", async () => {
    const testCase = makeTestCase({
      expectedCriteria: [],
      assertions: [{ type: "regex", pattern: "useState" }],
    });

    const result = await evaluateResponse(testCase, "useState onChange", {});

    expect(result.passed).toBe(true);
  });

  it("leaves results unchanged for test cases without assertions", async () => {
    const result = await evaluateResponse(
      makeTestCase(),
      "useState and onChange, a long enough answer",
      makeConfig("MET: YES\nREASONING: ok"),
    );

    expect(result).not.toHaveProperty("assertionResults");
    expect(result).not.toHaveProperty("toolCalls");
  });
});

describe("compareWithBaseline with assertions", () => {
  const assertion = { type: "regex" as const, pattern: "ok" };
  const withAssertion = (passed: boolean, score = 0.9) =>
    makeResult({
      score,
      assertionResults: [
        { assertion, label: "regex /ok/", passed, required: false, message: "" },
      ],
    });

  it("flags an assertion that passed in the baseline and fails now", () => {
    const [comparison] = compareWithBaseline([withAssertion(false)], [withAssertion(true)]);

    expect(comparison.regression).toBe(true);
    expect(comparison.assertionRegressions).toEqual(["regex /ok/"]);
  });

  it("does not flag an assertion that was already failing", () => {
    const [comparison] = compareWithBaseline([withAssertion(false)], [withAssertion(false)]);

    expect(comparison.regression).toBe(false);
    expect(comparison).not.toHaveProperty("assertionRegressions");
  });

  it("tolerates baselines recorded before assertions existed", () => {
    const [comparison] = compareWithBaseline([withAssertion(false)], [makeResult()]);

    expect(comparison.regression).toBe(false);
  });

  it("reports assertion results and assertion regressions", () => {
    const current = withAssertion(false);
    const comparisons = compareWithBaseline([current], [withAssertion(true)]);

    const report = generateReport([current], comparisons);

    expect(report).toContain("**Assertions:**");
    expect(report).toContain("- ❌ regex /ok/ (optional)");
    expect(report).toContain("assertion now failing: regex /ok/");
  });
});

describe("generateReport formatting", () => {
  it("checks the response length against the test case's minimum", () => {
    const report = generateReport([
      makeResult({ testId: "short-ok", responseLength: 36, minResponseLength: 20 }),
      makeResult({ testId: "too-short", responseLength: 36, minResponseLength: 50 }),
    ]);

    expect(report).toContain("**Response Length:** 36 chars (min: 20, met)");
    expect(report).toContain("**Response Length:** 36 chars (min: 50, not met)");
  });

  it("omits the length verdict for results saved without a minimum", () => {
    const report = generateReport([makeResult({ responseLength: 90 })]);

    expect(report).toContain("**Response Length:** 90 chars\n");
  });

  it("does not print -0.0% for a floating-point delta", () => {
    const comparisons: ComparisonResult[] = [
      {
        testId: "t",
        baselineScore: 1,
        currentScore: 0.9999999999999999,
        delta: -1.1102230246251565e-16,
        regression: true,
        improvement: false,
        assertionRegressions: ["regex /ok/"],
      },
    ];

    const report = generateReport([makeResult({ testId: "t" })], comparisons);

    expect(report).toContain("- t: 100.0% -> 100.0% (0.0%)");
  });
});

describe("generateReport markers", () => {
  it("marks criteria, assertions and keywords with emoji that survive Markdown rendering", () => {
    const report = generateReport([
      makeResult({
        criteriaResults: [
          { criterion: "Is polite", met: true, reasoning: "yes" },
          { criterion: "Cites a source", met: false, reasoning: "no" },
        ],
        assertionResults: [
          {
            assertion: { type: "toolCalled", name: "search" },
            label: "toolCalled search",
            passed: false,
            required: true,
            message: "Not called",
          },
        ],
        keywordMatches: [
          { keyword: "useState", found: true },
          { keyword: "useEffect", found: false },
        ],
      }),
    ]);

    expect(report).toContain("- ✅ Is polite\n");
    expect(report).toContain("- ❌ Cites a source\n");
    expect(report).toContain("- ❌ toolCalled search\n");
    expect(report).toContain("**Keywords:** ✅ useState, ❌ useEffect");
    // No "- +" / "- -" lines, which Markdown renders as nested bullets without the marker.
    expect(report).not.toMatch(/^- [+-] /m);
  });
});
