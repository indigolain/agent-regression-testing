import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "../src/args.js";
import { parseConfig } from "../src/config.js";
import {
  buildDashboardModel,
  generateDashboard,
  loadRunHistory,
  writeDashboard,
  type DashboardRun,
} from "../src/dashboard.js";
import { runTests } from "../src/runner.js";
import type { AssertionResult, EvaluationResult } from "../src/types.js";

const assertion = (label: string, passed: boolean): AssertionResult => ({
  assertion: { type: "regex", pattern: "x" },
  label,
  passed,
  required: true,
  message: passed ? "ok" : "nope",
});

const result = (testId: string, passed: boolean, extra?: Partial<EvaluationResult>): EvaluationResult => ({
  testId,
  question: `question for ${testId}`,
  response: `response for ${testId}`,
  passed,
  score: passed ? 1 : 0.5,
  criteriaResults: [],
  keywordMatches: [],
  responseLength: 10,
  evaluationTime: 1,
  timestamp: "2026-11-01T00:00:00.000Z",
  ...extra,
});

const run = (id: number, results: EvaluationResult[]): DashboardRun => ({
  id: String(id),
  timestamp: new Date(id).toISOString(),
  results,
});

const history = [
  run(1_700_000_000_000, [
    result("refund", true, { assertionResults: [assertion("toolCalled issue_refund", true)] }),
    result("greeting", true),
  ]),
  run(1_700_000_100_000, [
    result("refund", false, { assertionResults: [assertion("toolCalled issue_refund", false)] }),
    result("greeting", true),
    result("status", false),
  ]),
];

describe("buildDashboardModel", () => {
  it("summarizes each run, oldest first", () => {
    const model = buildDashboardModel([history[1], history[0]]);

    expect(model.runs.map((r) => r.id)).toEqual(["1700000000000", "1700000100000"]);
    expect(model.runs[0]).toMatchObject({ total: 2, passed: 2, passRate: 1, averageScore: 1, failedAssertions: 0 });
    expect(model.runs[1]).toMatchObject({ total: 3, passed: 1, failedAssertions: 1 });
    expect(model.runs[1].passRate).toBeCloseTo(1 / 3);
    expect(model.runs[1].averageScore).toBeCloseTo(2 / 3);
  });

  it("lists test cases failing in the latest run first, with a cell per run", () => {
    const model = buildDashboardModel(history);

    expect(model.tests.map((t) => t.testId)).toEqual(["refund", "status", "greeting"]);
    expect(model.tests[1].cells).toEqual([null, { passed: false, score: 0.5 }]);
  });

  it("counts assertion failures and finds newly failing test cases", () => {
    const model = buildDashboardModel(history);

    expect(model.topFailingAssertions).toEqual([
      {
        testId: "refund",
        label: "toolCalled issue_refund",
        failures: 1,
        evaluated: 2,
        lastFailedRunId: "1700000100000",
      },
    ]);
    // "status" is new in the latest run, so it isn't "newly failing".
    expect(model.newlyFailing).toEqual(["refund"]);
  });

  it("keeps only the most recent maxRuns", () => {
    const model = buildDashboardModel(history, { maxRuns: 1 });

    expect(model.runs).toHaveLength(1);
    expect(model.runs[0].id).toBe("1700000100000");
    expect(model.newlyFailing).toEqual([]);
  });

  it("treats null scores from older result files as zero", () => {
    const model = buildDashboardModel([
      run(1, [result("a", false, { score: null as unknown as number })]),
    ]);

    expect(model.runs[0].averageScore).toBe(0);
    expect(model.tests[0].cells[0]).toEqual({ passed: false, score: 0 });
  });
});

describe("generateDashboard", () => {
  it("renders a self-contained page with the latest numbers", () => {
    const html = generateDashboard(history, { title: "My agent" });

    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<title>My agent</title>");
    expect(html).toContain('<div class="hero-value">33.3%</div>');
    expect(html).toContain("1 of 3 test cases passed");
    expect(html).toContain("▼ 66.7 pts");
    expect(html).toContain("toolCalled issue_refund");
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
  });

  it("escapes user content in markup and embedded data", () => {
    const evil = "</script><img src=x onerror=alert(1)>";
    const html = generateDashboard([
      run(1, [result(evil, false, { response: evil, assertionResults: [assertion(evil, false)] })]),
    ]);

    expect(html).not.toContain("<img src=x");
    expect(html.match(/<\/script>/g)).toHaveLength(2); // only the page's own two scripts
  });

  it("renders an empty state when there are no runs", () => {
    const html = generateDashboard([]);

    expect(html).toContain("No runs yet");
  });
});

describe("loadRunHistory and writeDashboard", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "art-dashboard-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("loads saved results files oldest first and ignores other files", async () => {
    await fs.writeFile(path.join(dir, "results-2000.json"), JSON.stringify([result("b", true)]));
    await fs.writeFile(path.join(dir, "results-1000.json"), JSON.stringify([result("a", true)]));
    await fs.writeFile(path.join(dir, "results-1000.md"), "# report");
    await fs.writeFile(path.join(dir, "baseline.json"), "[]");

    const runs = await loadRunHistory(dir);

    expect(runs.map((r) => r.id)).toEqual(["1000", "2000"]);
    expect(runs[0].timestamp).toBe(new Date(1000).toISOString());
    expect(runs[0].results[0].testId).toBe("a");
  });

  it("skips unreadable results files with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await fs.writeFile(path.join(dir, "results-1000.json"), "{ not json");

    expect(await loadRunHistory(dir)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("results-1000.json"));
    warn.mockRestore();
  });

  it("returns no runs for a missing directory", async () => {
    expect(await loadRunHistory(path.join(dir, "missing"))).toEqual([]);
  });

  it("writes dashboard.html next to the results by default", async () => {
    await fs.writeFile(path.join(dir, "results-1000.json"), JSON.stringify([result("a", true)]));

    const written = await writeDashboard(dir);

    expect(written).toBe(path.join(dir, "dashboard.html"));
    expect(await fs.readFile(written, "utf-8")).toContain("1 of 1 test cases passed");
  });

  it("writes the dashboard after each run when the runner's dashboard option is set", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runTests({
      testCases: [
        { id: "t", category: "c", question: "q", expectedCriteria: [], keywords: [], minResponseLength: 0 },
      ],
      agent: async () => "answer",
      saveResults: true,
      outputDir: dir,
      dashboard: true,
    });
    log.mockRestore();

    const html = await fs.readFile(path.join(dir, "dashboard.html"), "utf-8");
    expect(html).toContain("1 of 1 test cases passed");
  });
});

describe("dashboard config and CLI arguments", () => {
  it("parses the dashboard config option", () => {
    expect(parseConfig("dashboard: true").dashboard).toBe(true);
    expect(() => parseConfig("dashboard: yes please")).toThrow("dashboard must be a boolean");
  });

  it("splits positional arguments from --options", () => {
    expect(parseArgs(["./results", "--out", "site/index.html", "--title", "Nightly"])).toEqual({
      positional: ["./results"],
      options: { out: "site/index.html", title: "Nightly" },
    });
    expect(() => parseArgs(["--out"])).toThrow("Missing value for --out");
  });
});
