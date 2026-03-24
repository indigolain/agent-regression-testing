import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { init } from "../src/init.js";

describe("init", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "art-init-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates config.yml and test-cases.json in the default paths", async () => {
    const { created, skipped } = await init({ outputDir: tmpDir });

    expect(created).toHaveLength(2);
    expect(skipped).toHaveLength(0);

    const configPath = path.join(tmpDir, "agent-regression/config.yml");
    const testCasesPath = path.join(tmpDir, "agent-regression/test-cases.json");

    const configContent = await fs.readFile(configPath, "utf-8");
    expect(configContent).toContain("scoringWeights:");
    expect(configContent).toContain("passThreshold:");
    expect(configContent).toContain("retryConfig:");

    const testCases = JSON.parse(await fs.readFile(testCasesPath, "utf-8"));
    expect(Array.isArray(testCases)).toBe(true);
    expect(testCases[0].id).toBe("example-1");
    expect(testCases[0].expectedCriteria).toBeDefined();
    expect(testCases[0].keywords).toBeDefined();
  });

  it("skips existing files by default", async () => {
    // First init
    await init({ outputDir: tmpDir });

    // Modify config to verify it's not overwritten
    const configPath = path.join(tmpDir, "agent-regression/config.yml");
    await fs.writeFile(configPath, "# custom config\n");

    // Second init
    const { created, skipped } = await init({ outputDir: tmpDir });

    expect(created).toHaveLength(0);
    expect(skipped).toHaveLength(2);

    const content = await fs.readFile(configPath, "utf-8");
    expect(content).toBe("# custom config\n");
  });

  it("overwrites existing files when skipExisting is false", async () => {
    // First init
    await init({ outputDir: tmpDir });

    const configPath = path.join(tmpDir, "agent-regression/config.yml");
    await fs.writeFile(configPath, "# custom config\n");

    // Second init with overwrite
    const { created, skipped } = await init({
      outputDir: tmpDir,
      skipExisting: false,
    });

    expect(created).toHaveLength(2);
    expect(skipped).toHaveLength(0);

    const content = await fs.readFile(configPath, "utf-8");
    expect(content).toContain("scoringWeights:");
  });

  it("supports custom file paths", async () => {
    const { created } = await init({
      outputDir: tmpDir,
      configPath: "custom/my-config.yml",
      testCasesPath: "custom/my-tests.json",
    });

    expect(created).toHaveLength(2);
    expect(created[0]).toContain("custom/my-config.yml");
    expect(created[1]).toContain("custom/my-tests.json");

    const configContent = await fs.readFile(
      path.join(tmpDir, "custom/my-config.yml"),
      "utf-8",
    );
    expect(configContent).toContain("scoringWeights:");
  });

  it("creates nested directories as needed", async () => {
    const { created } = await init({
      outputDir: tmpDir,
      configPath: "deep/nested/dir/config.yml",
    });

    expect(created.some((f) => f.includes("deep/nested/dir/config.yml"))).toBe(true);
  });

  it("generates valid YAML that can be parsed", async () => {
    await init({ outputDir: tmpDir });

    const { loadConfig } = await import("../src/config.js");
    const configPath = path.join(tmpDir, "agent-regression/config.yml");
    const config = await loadConfig(configPath);

    expect(config.passThreshold).toBe(0.7);
    expect(config.scoringWeights?.criteria).toBe(0.6);
    expect(config.retryConfig?.maxRetries).toBe(3);
  });

  it("generates valid JSON test cases", async () => {
    await init({ outputDir: tmpDir });

    const testCasesPath = path.join(tmpDir, "agent-regression/test-cases.json");
    const testCases = JSON.parse(await fs.readFile(testCasesPath, "utf-8"));

    for (const tc of testCases) {
      expect(typeof tc.id).toBe("string");
      expect(typeof tc.category).toBe("string");
      expect(typeof tc.question).toBe("string");
      expect(Array.isArray(tc.expectedCriteria)).toBe(true);
      expect(Array.isArray(tc.keywords)).toBe(true);
      expect(typeof tc.minResponseLength).toBe("number");
    }
  });
});
