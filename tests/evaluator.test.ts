import { describe, expect, it, vi } from "vitest";
import {
  compareWithBaseline,
  evaluateResponse,
  generateReport,
} from "../src/evaluator.js";
import type {
  ComparisonResult,
  EvaluationConfig,
  EvaluationResult,
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
