import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("cli", () => {
  it("starts with a node shebang, so the installed bin runs under node", async () => {
    const source = await fs.readFile(path.join(import.meta.dirname, "../src/cli.ts"), "utf-8");

    expect(source.split("\n")[0]).toBe("#!/usr/bin/env node");
  });
});
