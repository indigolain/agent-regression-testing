import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupBaseline,
  loadBaseline,
  saveBaseline,
} from "../src/baseline.js";
import type { EvaluationResult } from "../src/types.js";

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

describe("baseline file operations", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "art-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("loadBaseline", () => {
    it("loads and parses a valid baseline file", async () => {
      const filePath = path.join(tmpDir, "baseline.json");
      const data = [makeResult({ testId: "t1" }), makeResult({ testId: "t2" })];
      await fs.writeFile(filePath, JSON.stringify(data));

      const result = await loadBaseline(filePath);

      expect(result).toEqual(data);
    });

    it("returns null when file does not exist", async () => {
      const result = await loadBaseline(path.join(tmpDir, "nonexistent.json"));
      expect(result).toBeNull();
    });
  });

  describe("saveBaseline", () => {
    it("writes results to a JSON file", async () => {
      const filePath = path.join(tmpDir, "baseline.json");
      const data = [makeResult()];

      await saveBaseline(filePath, data);

      const written = JSON.parse(await fs.readFile(filePath, "utf-8"));
      expect(written).toEqual(data);
    });

    it("creates parent directories if needed", async () => {
      const filePath = path.join(tmpDir, "nested", "dir", "baseline.json");
      await saveBaseline(filePath, [makeResult()]);

      const written = JSON.parse(await fs.readFile(filePath, "utf-8"));
      expect(written).toHaveLength(1);
    });

    it("overwrites existing file", async () => {
      const filePath = path.join(tmpDir, "baseline.json");
      await saveBaseline(filePath, [makeResult({ testId: "old" })]);
      await saveBaseline(filePath, [makeResult({ testId: "new" })]);

      const written = JSON.parse(await fs.readFile(filePath, "utf-8"));
      expect(written[0].testId).toBe("new");
    });
  });

  describe("backupBaseline", () => {
    it("creates a timestamped backup of an existing file", async () => {
      const filePath = path.join(tmpDir, "baseline.json");
      await fs.writeFile(filePath, JSON.stringify([makeResult()]));

      await backupBaseline(filePath);

      const files = await fs.readdir(tmpDir);
      const backupFiles = files.filter((f) => f.startsWith("baseline-backup-"));
      expect(backupFiles).toHaveLength(1);

      const backupContent = JSON.parse(
        await fs.readFile(path.join(tmpDir, backupFiles[0]), "utf-8"),
      );
      expect(backupContent).toEqual([makeResult()]);
    });

    it("does not throw when file does not exist", async () => {
      await expect(
        backupBaseline(path.join(tmpDir, "nonexistent.json")),
      ).resolves.toBeUndefined();
    });
  });
});
