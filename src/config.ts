import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { ConfigFile, EvaluationResult, LoadedConfig, TestCase } from "./types.js";

/**
 * Loads configuration from a YAML file.
 * If testCasesPath is specified, loads test cases from that path (resolved relative to the config file).
 * If baselinePath is specified, loads baseline from that path (resolved relative to the config file).
 */
export async function loadConfig(filePath: string): Promise<LoadedConfig> {
  const content = await fs.readFile(filePath, "utf-8");
  const config = parseConfig(content);
  const configDir = path.dirname(path.resolve(filePath));

  const loaded: LoadedConfig = { ...config };

  if (config.testCasesPath) {
    const resolved = path.resolve(configDir, config.testCasesPath);
    const data = await fs.readFile(resolved, "utf-8");
    loaded.testCases = JSON.parse(data) as TestCase[];
  }

  if (config.baselinePath) {
    const resolved = path.resolve(configDir, config.baselinePath);
    try {
      const data = await fs.readFile(resolved, "utf-8");
      loaded.baseline = JSON.parse(data) as EvaluationResult[];
    } catch {
      // Baseline file not found — leave undefined
    }
  }

  return loaded;
}

/**
 * Parses a YAML string into a ConfigFile.
 * Does not load testCases or baseline from paths — use loadConfig() for that.
 */
export function parseConfig(yamlContent: string): ConfigFile {
  const raw = parse(yamlContent);
  if (raw === null || raw === undefined) {
    return {};
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Config must be a YAML mapping");
  }
  return validateConfig(raw);
}

function validateConfig(raw: Record<string, unknown>): ConfigFile {
  const config: ConfigFile = {};

  if (raw.scoringWeights !== undefined) {
    const w = raw.scoringWeights;
    if (typeof w !== "object" || w === null || Array.isArray(w)) {
      throw new Error("scoringWeights must be a mapping with criteria, keywords, and length");
    }
    const weights = w as Record<string, unknown>;
    if (
      typeof weights.criteria !== "number" ||
      typeof weights.keywords !== "number" ||
      typeof weights.length !== "number"
    ) {
      throw new Error("scoringWeights.criteria, .keywords, and .length must be numbers");
    }
    config.scoringWeights = {
      criteria: weights.criteria,
      keywords: weights.keywords,
      length: weights.length,
    };
  }

  if (raw.passThreshold !== undefined) {
    if (typeof raw.passThreshold !== "number") {
      throw new Error("passThreshold must be a number");
    }
    config.passThreshold = raw.passThreshold;
  }

  if (raw.regressionThreshold !== undefined) {
    if (typeof raw.regressionThreshold !== "number") {
      throw new Error("regressionThreshold must be a number");
    }
    config.regressionThreshold = raw.regressionThreshold;
  }

  if (raw.evaluationPromptTemplate !== undefined) {
    if (typeof raw.evaluationPromptTemplate !== "string") {
      throw new Error("evaluationPromptTemplate must be a string");
    }
    config.evaluationPromptTemplate = raw.evaluationPromptTemplate;
  }

  if (raw.retryConfig !== undefined) {
    const r = raw.retryConfig;
    if (typeof r !== "object" || r === null || Array.isArray(r)) {
      throw new Error("retryConfig must be a mapping");
    }
    const retry = r as Record<string, unknown>;
    if (typeof retry.maxRetries !== "number") {
      throw new Error("retryConfig.maxRetries must be a number");
    }
    if (typeof retry.initialDelay !== "number") {
      throw new Error("retryConfig.initialDelay must be a number");
    }
    if (typeof retry.backoffMultiplier !== "number") {
      throw new Error("retryConfig.backoffMultiplier must be a number");
    }
    if (!Array.isArray(retry.retryOnStatusCodes)) {
      throw new Error("retryConfig.retryOnStatusCodes must be an array");
    }
    config.retryConfig = {
      maxRetries: retry.maxRetries,
      initialDelay: retry.initialDelay,
      backoffMultiplier: retry.backoffMultiplier,
      retryOnStatusCodes: retry.retryOnStatusCodes as number[],
    };
  }

  if (raw.interCallDelay !== undefined) {
    if (typeof raw.interCallDelay !== "number") {
      throw new Error("interCallDelay must be a number");
    }
    config.interCallDelay = raw.interCallDelay;
  }

  if (raw.saveResults !== undefined) {
    if (typeof raw.saveResults !== "boolean") {
      throw new Error("saveResults must be a boolean");
    }
    config.saveResults = raw.saveResults;
  }

  if (raw.outputDir !== undefined) {
    if (typeof raw.outputDir !== "string") {
      throw new Error("outputDir must be a string");
    }
    config.outputDir = raw.outputDir;
  }

  if (raw.testCasesPath !== undefined) {
    if (typeof raw.testCasesPath !== "string") {
      throw new Error("testCasesPath must be a string");
    }
    config.testCasesPath = raw.testCasesPath;
  }

  if (raw.baselinePath !== undefined) {
    if (typeof raw.baselinePath !== "string") {
      throw new Error("baselinePath must be a string");
    }
    config.baselinePath = raw.baselinePath;
  }

  return config;
}
