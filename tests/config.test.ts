import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, parseConfig } from "../src/config.js";

describe("parseConfig", () => {
  it("parses a full config", () => {
    const yaml = `
scoringWeights:
  criteria: 0.5
  keywords: 0.4
  length: 0.1
passThreshold: 0.8
regressionThreshold: 0.15
evaluationPromptTemplate: |
  Evaluate: {{question}} {{response}} {{criterion}}
retryConfig:
  maxRetries: 5
  initialDelay: 1000
  backoffMultiplier: 3
  retryOnStatusCodes:
    - 429
    - 503
interCallDelay: 250
saveResults: true
outputDir: ./output
testCasesPath: ./tests/cases.json
baselinePath: ./tests/baseline.json
`;

    const config = parseConfig(yaml);

    expect(config.scoringWeights).toEqual({ criteria: 0.5, keywords: 0.4, length: 0.1 });
    expect(config.passThreshold).toBe(0.8);
    expect(config.regressionThreshold).toBe(0.15);
    expect(config.evaluationPromptTemplate).toContain("Evaluate:");
    expect(config.retryConfig).toEqual({
      maxRetries: 5,
      initialDelay: 1000,
      backoffMultiplier: 3,
      retryOnStatusCodes: [429, 503],
    });
    expect(config.interCallDelay).toBe(250);
    expect(config.saveResults).toBe(true);
    expect(config.outputDir).toBe("./output");
    expect(config.testCasesPath).toBe("./tests/cases.json");
    expect(config.baselinePath).toBe("./tests/baseline.json");
  });

  it("parses a minimal config with only some fields", () => {
    const yaml = `
passThreshold: 0.9
`;
    const config = parseConfig(yaml);

    expect(config.passThreshold).toBe(0.9);
    expect(config.scoringWeights).toBeUndefined();
    expect(config.retryConfig).toBeUndefined();
    expect(config.outputDir).toBeUndefined();
  });

  it("parses testCasesPath and baselinePath as strings", () => {
    const yaml = `
testCasesPath: ./cases.json
baselinePath: ./baseline.json
`;
    const config = parseConfig(yaml);

    expect(config.testCasesPath).toBe("./cases.json");
    expect(config.baselinePath).toBe("./baseline.json");
  });

  it("returns empty config for empty YAML", () => {
    expect(parseConfig("")).toEqual({});
    expect(parseConfig("# just a comment")).toEqual({});
  });

  it("throws on non-mapping YAML", () => {
    expect(() => parseConfig("- item1\n- item2")).toThrow("Config must be a YAML mapping");
    expect(() => parseConfig("42")).toThrow("Config must be a YAML mapping");
  });

  it("throws on invalid scoringWeights type", () => {
    expect(() => parseConfig("scoringWeights: 42")).toThrow("scoringWeights must be a mapping");
  });

  it("throws on non-numeric scoringWeights fields", () => {
    const yaml = `
scoringWeights:
  criteria: high
  keywords: 0.3
  length: 0.1
`;
    expect(() => parseConfig(yaml)).toThrow("scoringWeights.criteria, .keywords, and .length must be numbers");
  });

  it("throws on invalid passThreshold type", () => {
    expect(() => parseConfig("passThreshold: high")).toThrow("passThreshold must be a number");
  });

  it("throws on invalid regressionThreshold type", () => {
    expect(() => parseConfig("regressionThreshold: low")).toThrow("regressionThreshold must be a number");
  });

  it("throws on invalid retryConfig type", () => {
    expect(() => parseConfig("retryConfig: 3")).toThrow("retryConfig must be a mapping");
  });

  it("throws on invalid retryConfig fields", () => {
    const yaml = `
retryConfig:
  maxRetries: many
  initialDelay: 1000
  backoffMultiplier: 2
  retryOnStatusCodes:
    - 429
`;
    expect(() => parseConfig(yaml)).toThrow("retryConfig.maxRetries must be a number");
  });

  it("throws on invalid interCallDelay type", () => {
    expect(() => parseConfig("interCallDelay: fast")).toThrow("interCallDelay must be a number");
  });

  it("throws on invalid saveResults type", () => {
    expect(() => parseConfig("saveResults: yes")).toThrow("saveResults must be a boolean");
  });

  it("throws on invalid outputDir type", () => {
    expect(() => parseConfig("outputDir: 123")).toThrow("outputDir must be a string");
  });

  it("throws on invalid testCasesPath type", () => {
    expect(() => parseConfig("testCasesPath: 123")).toThrow("testCasesPath must be a string");
  });

  it("throws on invalid baselinePath type", () => {
    expect(() => parseConfig("baselinePath: 123")).toThrow("baselinePath must be a string");
  });

  it("throws on invalid evaluationPromptTemplate type", () => {
    expect(() => parseConfig("evaluationPromptTemplate: 123")).toThrow(
      "evaluationPromptTemplate must be a string",
    );
  });
});

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "art-config-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loads and parses a YAML config file", async () => {
    const filePath = path.join(tmpDir, "config.yml");
    await fs.writeFile(
      filePath,
      `passThreshold: 0.85\nregressionThreshold: 0.1\n`,
    );

    const config = await loadConfig(filePath);

    expect(config.passThreshold).toBe(0.85);
    expect(config.regressionThreshold).toBe(0.1);
  });

  it("throws when file does not exist", async () => {
    await expect(
      loadConfig(path.join(tmpDir, "nonexistent.yml")),
    ).rejects.toThrow();
  });

  it("loads testCases from testCasesPath relative to config file", async () => {
    const testCases = [
      { id: "t1", category: "general", question: "Q?", expectedCriteria: ["C"], keywords: ["k"], minResponseLength: 10 },
    ];
    await fs.writeFile(path.join(tmpDir, "cases.json"), JSON.stringify(testCases));
    await fs.writeFile(
      path.join(tmpDir, "config.yml"),
      "testCasesPath: ./cases.json\n",
    );

    const config = await loadConfig(path.join(tmpDir, "config.yml"));

    expect(config.testCases).toEqual(testCases);
  });

  it("loads baseline from baselinePath relative to config file", async () => {
    const baseline = [
      { testId: "t1", question: "Q?", response: "R", passed: true, score: 0.9, criteriaResults: [], keywordMatches: [], responseLength: 1, evaluationTime: 100, timestamp: "2026-01-01T00:00:00.000Z" },
    ];
    await fs.writeFile(path.join(tmpDir, "baseline.json"), JSON.stringify(baseline));
    await fs.writeFile(
      path.join(tmpDir, "config.yml"),
      "baselinePath: ./baseline.json\n",
    );

    const config = await loadConfig(path.join(tmpDir, "config.yml"));

    expect(config.baseline).toEqual(baseline);
  });

  it("leaves baseline undefined when baselinePath file does not exist", async () => {
    await fs.writeFile(
      path.join(tmpDir, "config.yml"),
      "baselinePath: ./nonexistent.json\n",
    );

    const config = await loadConfig(path.join(tmpDir, "config.yml"));

    expect(config.baseline).toBeUndefined();
  });

  it("throws when testCasesPath file does not exist", async () => {
    await fs.writeFile(
      path.join(tmpDir, "config.yml"),
      "testCasesPath: ./nonexistent.json\n",
    );

    await expect(loadConfig(path.join(tmpDir, "config.yml"))).rejects.toThrow();
  });

  it("does not set testCases when testCasesPath is not specified", async () => {
    await fs.writeFile(
      path.join(tmpDir, "config.yml"),
      "passThreshold: 0.8\n",
    );

    const config = await loadConfig(path.join(tmpDir, "config.yml"));

    expect(config.testCases).toBeUndefined();
  });

  it("resolves paths relative to config file directory, not cwd", async () => {
    const subDir = path.join(tmpDir, "nested", "dir");
    await fs.mkdir(subDir, { recursive: true });

    const testCases = [{ id: "t1", category: "g", question: "Q", expectedCriteria: [], keywords: [], minResponseLength: 0 }];
    await fs.writeFile(path.join(subDir, "cases.json"), JSON.stringify(testCases));
    await fs.writeFile(
      path.join(subDir, "config.yml"),
      "testCasesPath: ./cases.json\n",
    );

    const config = await loadConfig(path.join(subDir, "config.yml"));

    expect(config.testCases).toEqual(testCases);
  });
});
