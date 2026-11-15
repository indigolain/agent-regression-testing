import type {
  AgentRun,
  Assertion,
  AssertionResult,
  CheckFunction,
  SkillDetection,
  TestCase,
  ToolCall,
} from "./types.js";

export const DEFAULT_SKILL_DETECTION: SkillDetection = {
  toolName: "Skill",
  argKey: "skill",
};

export interface AssertionContext {
  checks?: Record<string, CheckFunction>;
  skillDetection?: SkillDetection;
}

const ASSERTION_TYPES = new Set([
  "toolCalled",
  "toolNotCalled",
  "toolOrder",
  "skillTriggered",
  "regex",
  "check",
]);

/**
 * Runs every assertion of a test case against an agent run, in order.
 */
export async function evaluateAssertions(
  assertions: Assertion[],
  run: AgentRun,
  testCase: TestCase,
  context: AssertionContext = {},
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];
  for (const assertion of assertions) {
    const { passed, message } = await evaluateAssertion(assertion, run, testCase, context);
    results.push({
      assertion,
      label: assertionLabel(assertion),
      passed,
      required: assertion.required !== false,
      message,
    });
  }
  return results;
}

/**
 * A human-readable label for an assertion, also used to match it against the baseline.
 */
export function assertionLabel(assertion: Assertion): string {
  if (assertion.description) return assertion.description;
  switch (assertion.type) {
    case "toolCalled": {
      const times = assertion.times === undefined ? "" : ` x${assertion.times}`;
      return `toolCalled ${assertion.name}${formatArgs(assertion.args)}${times}`;
    }
    case "toolNotCalled":
      return `toolNotCalled ${assertion.name}${formatArgs(assertion.args)}`;
    case "toolOrder":
      return `toolOrder ${assertion.names.join(" -> ")}`;
    case "skillTriggered":
      return `skillTriggered ${assertion.name}`;
    case "regex":
      return `regex /${assertion.pattern}/${assertion.flags ?? ""}`;
    case "check":
      return `check ${assertion.name}${formatArgs(assertion.params)}`;
  }
}

function formatArgs(args: Record<string, unknown> | undefined): string {
  return args === undefined ? "" : ` ${JSON.stringify(args)}`;
}

/**
 * Validates assertions loaded from JSON, throwing a descriptive error on the first bad one.
 */
export function validateAssertions(raw: unknown, testId: string): Assertion[] {
  if (!Array.isArray(raw)) {
    throw new Error(`Test case "${testId}": assertions must be an array`);
  }
  return raw.map((a, i) => {
    const where = `Test case "${testId}", assertion ${i}`;
    if (typeof a !== "object" || a === null || Array.isArray(a)) {
      throw new Error(`${where}: must be an object`);
    }
    const obj = a as Record<string, unknown>;
    if (typeof obj.type !== "string" || !ASSERTION_TYPES.has(obj.type)) {
      throw new Error(
        `${where}: unknown type ${JSON.stringify(obj.type)} (expected one of ${[...ASSERTION_TYPES].join(", ")})`,
      );
    }
    if (obj.required !== undefined && typeof obj.required !== "boolean") {
      throw new Error(`${where}: required must be a boolean`);
    }
    if (obj.description !== undefined && typeof obj.description !== "string") {
      throw new Error(`${where}: description must be a string`);
    }
    if (obj.type === "toolOrder") {
      if (!Array.isArray(obj.names) || obj.names.some((n) => typeof n !== "string")) {
        throw new Error(`${where}: toolOrder requires names: string[]`);
      }
    } else if (obj.type === "regex") {
      if (typeof obj.pattern !== "string") {
        throw new Error(`${where}: regex requires pattern: string`);
      }
      try {
        new RegExp(obj.pattern, (obj.flags as string | undefined) ?? "");
      } catch (error) {
        throw new Error(`${where}: invalid regex: ${(error as Error).message}`);
      }
    } else if (typeof obj.name !== "string") {
      throw new Error(`${where}: ${obj.type} requires name: string`);
    }
    for (const key of ["args", "params"] as const) {
      const v = obj[key];
      if (v !== undefined && (typeof v !== "object" || v === null || Array.isArray(v))) {
        throw new Error(`${where}: ${key} must be an object`);
      }
    }
    if (obj.times !== undefined && (!Number.isInteger(obj.times) || (obj.times as number) < 0)) {
      throw new Error(`${where}: times must be a non-negative integer`);
    }
    return obj as unknown as Assertion;
  });
}

async function evaluateAssertion(
  assertion: Assertion,
  run: AgentRun,
  testCase: TestCase,
  context: AssertionContext,
): Promise<{ passed: boolean; message: string }> {
  switch (assertion.type) {
    case "regex": {
      const re = new RegExp(assertion.pattern, assertion.flags);
      const match = re.exec(run.text);
      return match
        ? { passed: true, message: `Matched "${truncate(match[0])}"` }
        : { passed: false, message: "Response text did not match" };
    }

    case "check": {
      const check = context.checks?.[assertion.name];
      if (!check) {
        return { passed: false, message: `No check registered under "${assertion.name}"` };
      }
      try {
        const outcome = await check({ run, testCase, params: assertion.params });
        if (typeof outcome === "boolean") {
          return { passed: outcome, message: outcome ? "Check passed" : "Check failed" };
        }
        return {
          passed: outcome.passed,
          message: outcome.message ?? (outcome.passed ? "Check passed" : "Check failed"),
        };
      } catch (error) {
        return {
          passed: false,
          message: `Check threw: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    default:
      break;
  }

  // The remaining assertions inspect the tool-call trace. Without one, they
  // cannot be decided — failing is safer than passing `toolNotCalled` vacuously.
  const calls = run.toolCalls;
  if (calls === undefined) {
    return {
      passed: false,
      message: "Agent reported no tool-call trace; return an AgentRun with toolCalls",
    };
  }

  switch (assertion.type) {
    case "toolCalled": {
      const matching = calls.filter((c) => callMatches(c, assertion.name, assertion.args));
      if (assertion.times !== undefined) {
        const passed = matching.length === assertion.times;
        return {
          passed,
          message: `Called ${matching.length} time(s), expected ${assertion.times}`,
        };
      }
      if (matching.length > 0) {
        return { passed: true, message: `Called ${matching.length} time(s)` };
      }
      return { passed: false, message: `Not called. ${describeCalls(calls, assertion.name)}` };
    }

    case "toolNotCalled": {
      const matching = calls.filter((c) => callMatches(c, assertion.name, assertion.args));
      return matching.length === 0
        ? { passed: true, message: "Not called" }
        : { passed: false, message: `Called ${matching.length} time(s)` };
    }

    case "toolOrder": {
      let next = 0;
      for (const call of calls) {
        if (next < assertion.names.length && call.name === assertion.names[next]) next++;
      }
      if (next === assertion.names.length) {
        return { passed: true, message: "Called in order" };
      }
      return {
        passed: false,
        message: `Missing "${assertion.names[next]}" after ${
          next === 0 ? "start" : `"${assertion.names[next - 1]}"`
        }. Actual order: ${calls.map((c) => c.name).join(" -> ") || "(none)"}`,
      };
    }

    case "skillTriggered": {
      const { toolName, argKey } = context.skillDetection ?? DEFAULT_SKILL_DETECTION;
      const triggered = calls.some((c) => callMatches(c, toolName, { [argKey]: assertion.name }));
      if (triggered) return { passed: true, message: "Skill triggered" };
      const skills = calls
        .filter((c) => c.name === toolName)
        .map((c) => String((c.args as Record<string, unknown> | undefined)?.[argKey]));
      return {
        passed: false,
        message: skills.length
          ? `Skill not triggered. Triggered: ${skills.join(", ")}`
          : "Skill not triggered. No skills were triggered",
      };
    }
  }
}

function callMatches(
  call: ToolCall,
  name: string,
  args: Record<string, unknown> | undefined,
): boolean {
  return call.name === name && (args === undefined || partialMatch(args, call.args));
}

function describeCalls(calls: ToolCall[], name: string): string {
  const sameName = calls.filter((c) => c.name === name);
  if (sameName.length > 0) {
    return `Calls to "${name}" had args: ${sameName
      .map((c) => truncate(JSON.stringify(c.args)))
      .join("; ")}`;
  }
  return `Tools called: ${calls.map((c) => c.name).join(", ") || "(none)"}`;
}

/**
 * True when every key in `expected` deep-matches `actual`. Objects match
 * partially (extra keys in `actual` are fine); arrays match element-wise with
 * equal length.
 */
export function partialMatch(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((e, i) => partialMatch(e, actual[i]))
    );
  }
  if (typeof expected === "object" && expected !== null) {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) return false;
    const act = actual as Record<string, unknown>;
    return Object.entries(expected).every(([k, v]) => partialMatch(v, act[k]));
  }
  return Object.is(expected, actual);
}

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
