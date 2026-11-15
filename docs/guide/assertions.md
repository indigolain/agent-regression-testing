# Deterministic Assertions

LLM-as-judge is good at judging *what the agent said*. To check *what the agent did*, add `assertions` to a test case. They are evaluated in code, so they give the same answer every run.

```json
{
  "id": "refund-flow",
  "question": "Please refund order #123",
  "assertions": [
    { "type": "skillTriggered", "name": "refunds" },
    { "type": "toolCalled", "name": "lookup_order", "args": { "orderId": "123" } },
    { "type": "toolOrder", "names": ["lookup_order", "issue_refund"] },
    { "type": "toolNotCalled", "name": "delete_customer" },
    { "type": "regex", "pattern": "refund (has been|was) issued", "flags": "i" },
    { "type": "check", "name": "orderMarkedRefunded", "params": { "orderId": "123" } }
  ]
}
```

In test case JSON, `expectedCriteria` and `keywords` default to `[]`, `minResponseLength` to `0`, and `category` to `"general"`, so a test case can consist of assertions only. A suite where no test case has criteria needs no judge at all.

## Reporting a trace from your agent

Assertions on tools and skills need to know what the agent called. Have your agent function return an `AgentRun` instead of a string:

```typescript
interface AgentRun {
  text: string;
  toolCalls?: { name: string; args?: unknown; result?: unknown }[];
  metadata?: Record<string, unknown>; // available to check functions
}
```

The agent also receives the current test case as a second argument. Returning a plain string keeps working, but then tool and skill assertions fail with a message asking for a trace (rather than `toolNotCalled` passing by default).

Most agent frameworks expose tool calls through step results, a message stream, or callbacks. Collect them into `toolCalls`:

```typescript
import type { ToolCall, TracedAgentFunction } from "agent-regression-testing";

const myTracedAgent: TracedAgentFunction = async (question) => {
  const toolCalls: ToolCall[] = [];
  const text = await myAgent.run(question, {
    onToolCall: (name, args) => toolCalls.push({ name, args }),
  });
  return { text, toolCalls };
};
```

## Assertion types

| Type | Fields | Passes when |
|------|--------|-------------|
| `toolCalled` | `name`, `args?`, `times?` | `name` was called (with matching `args`) at least once, or exactly `times` times |
| `toolNotCalled` | `name`, `args?` | No call to `name` (with matching `args`) was made |
| `toolOrder` | `names` | The tools were called in this relative order; other calls may sit between them |
| `skillTriggered` | `name` | The skill was invoked (see `skillDetection` below) |
| `regex` | `pattern`, `flags?` | The response text matches |
| `check` | `name`, `params?` | The [check function](#checking-database-or-other-state) registered as `name` passes |

`args` is a partial match: every key you give must deep-equal the call's argument, and extra arguments are ignored. Arrays must match element by element.

Every assertion also takes an optional `description`, used as its label in reports and baseline comparisons.

Skills show up in the trace as a tool call. By default `skillTriggered` looks for a `Skill` tool call whose `skill` argument is the skill's name, which is how the Claude Agent SDK reports them. For other frameworks, set `skillDetection` in the config:

```yaml
skillDetection:
  toolName: load_skill
  argKey: id
```

## Checking database or other state

For anything the trace can't show, such as a row the agent was supposed to update, register check functions by name and reference them from test cases. Use the `beforeEach` and `afterEach` hooks to put state in a known shape for every test:

```typescript
const config: RunnerConfig = {
  ...fileConfig,
  testCases: fileConfig.testCases!,
  agent: myTracedAgent,
  checks: {
    orderMarkedRefunded: async ({ params, run, testCase }) => {
      const order = await db.orders.find(params!.orderId as string);
      return { passed: order.status === "refunded", message: `status=${order.status}` };
    },
  },
  beforeEach: async (testCase) => db.seed(testCase.id),
  afterEach: async () => db.reset(),
};
```

A check returns a boolean or `{ passed, message? }`. A check that throws, or a name with no registered check, fails the assertion with an explanatory message.

Checks run after the agent answers and before `afterEach`. If `beforeEach` throws, the agent is not run and the test case fails. `afterEach` runs even when the test case errored, and a throw from it also fails the test case, since later tests could otherwise run against leftover state.

## Required vs. scored assertions

By default an assertion is **required**: if it fails, the test case fails whatever its score. Set `"required": false` to make it count towards the score instead. When a test case has scored assertions, the score gains an `assertions` component (weight `scoringWeights.assertions`, default `0.3`), and all weights are normalized to sum to one. Test cases without scored assertions are scored exactly as before.

Assertion results are saved with the other results. When comparing against a baseline, an assertion that passed in the baseline and fails now is reported as a regression even if the score barely moved. Baselines recorded before assertions existed are compared on score alone.
