import { describe, expect, it, vi } from "vitest";
import {
  assertionLabel,
  evaluateAssertions,
  partialMatch,
  validateAssertions,
} from "../src/assertions.js";
import type { AgentRun, Assertion, TestCase } from "../src/types.js";

const testCase: TestCase = {
  id: "refund",
  category: "orders",
  question: "Refund order 123",
  expectedCriteria: [],
  keywords: [],
  minResponseLength: 0,
};

const run: AgentRun = {
  text: "Your refund has been issued.",
  toolCalls: [
    { name: "Skill", args: { skill: "refunds" } },
    { name: "lookup_order", args: { orderId: "123", include: ["items"] } },
    { name: "log", args: { level: "info" } },
    { name: "issue_refund", args: { orderId: "123", amount: 40 } },
  ],
};

const evaluateOne = async (assertion: Assertion, agentRun = run, context = {}) =>
  (await evaluateAssertions([assertion], agentRun, testCase, context))[0];

describe("partialMatch", () => {
  it("matches a subset of object keys, deeply", () => {
    expect(partialMatch({ a: 1 }, { a: 1, b: 2 })).toBe(true);
    expect(partialMatch({ a: { b: 1 } }, { a: { b: 1, c: 2 } })).toBe(true);
    expect(partialMatch({ a: 2 }, { a: 1 })).toBe(false);
    expect(partialMatch({ a: 1 }, undefined)).toBe(false);
  });

  it("requires arrays to match element-wise with equal length", () => {
    expect(partialMatch([1, 2], [1, 2])).toBe(true);
    expect(partialMatch([1], [1, 2])).toBe(false);
    expect(partialMatch([{ id: 1 }], [{ id: 1, x: 0 }])).toBe(true);
  });

  it("does not treat a string as matching a number", () => {
    expect(partialMatch({ id: "1" }, { id: 1 })).toBe(false);
  });
});

describe("toolCalled", () => {
  it("passes when the tool was called with matching args", async () => {
    const r = await evaluateOne({ type: "toolCalled", name: "lookup_order", args: { orderId: "123" } });
    expect(r.passed).toBe(true);
    expect(r.required).toBe(true);
  });

  it("fails and shows the actual args when args differ", async () => {
    const r = await evaluateOne({ type: "toolCalled", name: "lookup_order", args: { orderId: "999" } });
    expect(r.passed).toBe(false);
    expect(r.message).toContain('"orderId":"123"');
  });

  it("fails and lists called tools when the tool was not called", async () => {
    const r = await evaluateOne({ type: "toolCalled", name: "cancel_order" });
    expect(r.passed).toBe(false);
    expect(r.message).toContain("lookup_order");
  });

  it("checks an exact call count with times", async () => {
    expect((await evaluateOne({ type: "toolCalled", name: "log", times: 1 })).passed).toBe(true);
    const r = await evaluateOne({ type: "toolCalled", name: "log", times: 2 });
    expect(r.passed).toBe(false);
    expect(r.message).toBe("Called 1 time(s), expected 2");
  });
});

describe("toolNotCalled", () => {
  it("passes when the tool was not called", async () => {
    expect((await evaluateOne({ type: "toolNotCalled", name: "delete_customer" })).passed).toBe(true);
  });

  it("fails when the tool was called", async () => {
    expect((await evaluateOne({ type: "toolNotCalled", name: "issue_refund" })).passed).toBe(false);
  });

  it("only counts calls with matching args when args are given", async () => {
    const r = await evaluateOne({ type: "toolNotCalled", name: "issue_refund", args: { orderId: "456" } });
    expect(r.passed).toBe(true);
  });
});

describe("toolOrder", () => {
  it("passes for a subsequence in order", async () => {
    const r = await evaluateOne({ type: "toolOrder", names: ["lookup_order", "issue_refund"] });
    expect(r.passed).toBe(true);
  });

  it("fails when the order is reversed", async () => {
    const r = await evaluateOne({ type: "toolOrder", names: ["issue_refund", "lookup_order"] });
    expect(r.passed).toBe(false);
    expect(r.message).toContain('Missing "lookup_order" after "issue_refund"');
  });
});

describe("skillTriggered", () => {
  it("detects the default Skill tool call", async () => {
    expect((await evaluateOne({ type: "skillTriggered", name: "refunds" })).passed).toBe(true);
  });

  it("lists triggered skills when the expected one is missing", async () => {
    const r = await evaluateOne({ type: "skillTriggered", name: "billing" });
    expect(r.passed).toBe(false);
    expect(r.message).toContain("refunds");
  });

  it("honors a custom skillDetection", async () => {
    const custom: AgentRun = {
      text: "",
      toolCalls: [{ name: "load_skill", args: { id: "refunds" } }],
    };
    const r = await evaluateOne({ type: "skillTriggered", name: "refunds" }, custom, {
      skillDetection: { toolName: "load_skill", argKey: "id" },
    });
    expect(r.passed).toBe(true);
  });
});

describe("trace-based assertions without a trace", () => {
  it("fail rather than pass vacuously", async () => {
    const textOnly: AgentRun = { text: "done" };
    const r = await evaluateOne({ type: "toolNotCalled", name: "delete_customer" }, textOnly);
    expect(r.passed).toBe(false);
    expect(r.message).toContain("no tool-call trace");
  });

  it("treat an empty trace as no calls", async () => {
    const empty: AgentRun = { text: "done", toolCalls: [] };
    expect((await evaluateOne({ type: "toolNotCalled", name: "x" }, empty)).passed).toBe(true);
  });
});

describe("regex", () => {
  it("matches the response text", async () => {
    expect((await evaluateOne({ type: "regex", pattern: "refund (has been|was) issued" })).passed).toBe(true);
    expect((await evaluateOne({ type: "regex", pattern: "REFUND", flags: "i" })).passed).toBe(true);
    expect((await evaluateOne({ type: "regex", pattern: "^declined" })).passed).toBe(false);
  });
});

describe("check", () => {
  it("passes run, testCase and params to the check function", async () => {
    const check = vi.fn(async () => ({ passed: true, message: "status=refunded" }));
    const r = await evaluateOne(
      { type: "check", name: "orderRefunded", params: { orderId: "123" } },
      run,
      { checks: { orderRefunded: check } },
    );
    expect(check).toHaveBeenCalledWith({ run, testCase, params: { orderId: "123" } });
    expect(r).toMatchObject({ passed: true, message: "status=refunded" });
  });

  it("accepts a boolean outcome", async () => {
    const r = await evaluateOne({ type: "check", name: "c" }, run, { checks: { c: () => false } });
    expect(r).toMatchObject({ passed: false, message: "Check failed" });
  });

  it("fails when the check throws", async () => {
    const r = await evaluateOne({ type: "check", name: "c" }, run, {
      checks: {
        c: () => {
          throw new Error("db down");
        },
      },
    });
    expect(r).toMatchObject({ passed: false, message: "Check threw: db down" });
  });

  it("fails when no check is registered under the name", async () => {
    const r = await evaluateOne({ type: "check", name: "missing" });
    expect(r.passed).toBe(false);
    expect(r.message).toContain('"missing"');
  });
});

describe("assertionLabel", () => {
  it("prefers the description", () => {
    expect(assertionLabel({ type: "toolCalled", name: "x", description: "looks up" })).toBe("looks up");
  });

  it("generates a label including args", () => {
    expect(assertionLabel({ type: "toolCalled", name: "x", args: { a: 1 }, times: 2 })).toBe(
      'toolCalled x {"a":1} x2',
    );
    expect(assertionLabel({ type: "toolOrder", names: ["a", "b"] })).toBe("toolOrder a -> b");
  });
});

describe("required", () => {
  it("defaults to true and can be turned off", async () => {
    const [a, b] = await evaluateAssertions(
      [
        { type: "regex", pattern: "x" },
        { type: "regex", pattern: "x", required: false },
      ],
      run,
      testCase,
    );
    expect(a.required).toBe(true);
    expect(b.required).toBe(false);
  });
});

describe("validateAssertions", () => {
  it("accepts valid assertions", () => {
    const raw = [
      { type: "toolCalled", name: "a", args: { x: 1 }, times: 1 },
      { type: "toolOrder", names: ["a", "b"] },
      { type: "regex", pattern: "ok", flags: "i" },
      { type: "check", name: "c", params: {}, required: false },
    ];
    expect(validateAssertions(raw, "t")).toEqual(raw);
  });

  it.each([
    [{ type: "nope" }, "unknown type"],
    [{ type: "toolCalled" }, "requires name"],
    [{ type: "toolOrder", names: "a" }, "requires names"],
    [{ type: "regex", pattern: "(" }, "invalid regex"],
    [{ type: "toolCalled", name: "a", args: [1] }, "args must be an object"],
    [{ type: "toolCalled", name: "a", times: -1 }, "times must be"],
    [{ type: "regex", pattern: "a", required: "yes" }, "required must be a boolean"],
  ])("rejects %j", (assertion, message) => {
    expect(() => validateAssertions([assertion], "t")).toThrow(message);
  });

  it("names the test case and index in errors", () => {
    expect(() => validateAssertions([{ type: "regex", pattern: "a" }, {}], "my-test")).toThrow(
      'Test case "my-test", assertion 1',
    );
  });
});
