import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTests } from "../src/runner.js";
import type { EvaluationResult, RunnerConfig, TestCase } from "../src/types.js";

const makeTestCase = (overrides?: Partial<TestCase>): TestCase => ({
  id: "test-1",
  category: "general",
  question: "What is testing?",
  expectedCriteria: ["Is clear"],
  keywords: ["testing"],
  minResponseLength: 5,
  ...overrides,
});

const makeResult = (overrides?: Partial<EvaluationResult>): EvaluationResult => ({
  testId: "test-1",
  question: "q",
  response: "r",
  passed: true,
  score: 0.9,
  criteriaResults: [],
  keywordMatches: [],
  responseLength: 1,
  evaluationTime: 100,
  timestamp: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const makeConfig = (overrides?: Partial<RunnerConfig>): RunnerConfig => ({
  agent: vi.fn(async () => "Testing is a process of verifying software works."),
  evaluationLLM: vi.fn(async () => "MET: YES\nREASONING: Good."),
  testCases: [makeTestCase()],
  interCallDelay: 0,
  retryConfig: { maxRetries: 1, initialDelay: 0, backoffMultiplier: 1, retryOnStatusCodes: [429] },
  saveResults: false,
  ...overrides,
});

describe("runTests", () => {
  it("runs all test cases and returns results", async () => {
    const config = makeConfig();

    const { results, report, exitCode } = await runTests(config);

    expect(results).toHaveLength(1);
    expect(results[0].testId).toBe("test-1");
    expect(results[0].passed).toBe(true);
    expect(report).toContain("Agent Regression Test Report");
    expect(exitCode).toBe(0);
  });

  it("returns exitCode 1 when tests fail", async () => {
    const config = makeConfig({
      agent: vi.fn(async () => "x"),
      evaluationLLM: vi.fn(async () => "MET: NO\nREASONING: Bad."),
      testCases: [makeTestCase({ keywords: ["nonexistent"], minResponseLength: 9999 })],
    });

    const { exitCode, results } = await runTests(config);

    expect(results[0].passed).toBe(false);
    expect(exitCode).toBe(1);
  });

  it("handles agent errors gracefully", async () => {
    const config = makeConfig({
      agent: vi.fn().mockRejectedValue(new Error("Agent crashed")),
    });

    const { results, exitCode } = await runTests(config);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].score).toBe(0);
    expect(results[0].response).toBe("");
    expect(exitCode).toBe(1);
  });

  it("runs multiple test cases", async () => {
    const config = makeConfig({
      testCases: [
        makeTestCase({ id: "t1" }),
        makeTestCase({ id: "t2" }),
        makeTestCase({ id: "t3" }),
      ],
    });

    const { results } = await runTests(config);

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.testId)).toEqual(["t1", "t2", "t3"]);
  });

  it("compares with baseline when provided", async () => {
    const config = makeConfig({
      baseline: [makeResult({ testId: "test-1", score: 0.1 })],
    });

    const { report } = await runTests(config);

    expect(report).toContain("Comparison with Baseline");
  });

  it("detects regressions and sets exitCode 1", async () => {
    const config = makeConfig({
      evaluationLLM: vi.fn(async () => "MET: NO\nREASONING: Bad."),
      agent: vi.fn(async () => "x"),
      testCases: [makeTestCase({ keywords: ["x"], minResponseLength: 0 })],
      baseline: [makeResult({ testId: "test-1", score: 0.9 })],
    });

    const { exitCode, report } = await runTests(config);

    expect(exitCode).toBe(1);
    expect(report).toContain("Regressions");
  });

  describe("file output", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "art-runner-"));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("saves results and report when outputDir is set", async () => {
      const config = makeConfig({
        saveResults: true,
        outputDir: tmpDir,
      });

      await runTests(config);

      const files = await fs.readdir(tmpDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      const mdFiles = files.filter((f) => f.endsWith(".md"));
      expect(jsonFiles).toHaveLength(1);
      expect(mdFiles).toHaveLength(1);

      const savedResults = JSON.parse(
        await fs.readFile(path.join(tmpDir, jsonFiles[0]), "utf-8"),
      );
      expect(savedResults).toHaveLength(1);
      expect(savedResults[0].testId).toBe("test-1");
    });

    it("does not save files when saveResults is false", async () => {
      const config = makeConfig({
        saveResults: false,
        outputDir: tmpDir,
      });

      await runTests(config);

      const files = await fs.readdir(tmpDir);
      expect(files).toHaveLength(0);
    });
  });
});
