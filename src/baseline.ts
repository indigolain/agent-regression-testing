import fs from "node:fs/promises";
import path from "node:path";
import type { EvaluationResult } from "./types.js";

/**
 * Loads baseline results from a JSON file.
 * Returns null if the file does not exist.
 */
export async function loadBaseline(
  filePath: string,
): Promise<EvaluationResult[] | null> {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data) as EvaluationResult[];
  } catch {
    return null;
  }
}

/**
 * Saves evaluation results as a baseline JSON file.
 */
export async function saveBaseline(
  filePath: string,
  results: EvaluationResult[],
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(results, null, 2));
}

/**
 * Creates a timestamped backup of an existing baseline file.
 */
export async function backupBaseline(filePath: string): Promise<void> {
  try {
    const existingData = await fs.readFile(filePath, "utf-8");
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const backupPath = path.join(dir, `${base}-backup-${Date.now()}${ext}`);
    await fs.writeFile(backupPath, existingData);
    console.log(`Backed up existing baseline to: ${backupPath}`);
  } catch {
    console.log("No existing baseline to backup");
  }
}
