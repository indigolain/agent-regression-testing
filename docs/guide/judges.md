# Choosing a Judge

The library accepts two judge interfaces. Supply exactly one — `structuredJudge` wins if both are set. Omitting both is fine when no test case has `expectedCriteria` (a [deterministic-only](/guide/assertions) suite); otherwise test cases with criteria fail with an error.

## `evaluationLLM` — text in, text out

```typescript
type EvaluationLLM = (prompt: string) => Promise<string>;
```

Called **once per criterion** with `evaluationPromptTemplate` rendered, and must reply with `MET: YES|NO` and `REASONING:`. This is the right choice for chat models, which can explain themselves in prose. Note that calls are sequential and separated by `interCallDelay` (default 500ms), so a test case with five criteria makes five calls.

## `structuredJudge` — one call, all criteria

```typescript
type StructuredJudge = (input: {
  question: string;
  response: string;
  criteria: string[];
}) => Promise<CriterionVerdict[]>;

interface CriterionVerdict {
  met: boolean;
  reasoning?: string;   // defaults to a confidence summary
  confidence?: number;  // calibrated probability, 0..1 — kept on the result
}
```

Return **one verdict per criterion, in the same order as `criteria`**; a length mismatch fails the test case with a diagnostic rather than silently misaligning verdicts. `evaluationPromptTemplate` and `interCallDelay` do not apply — the judge owns its own prompting, and there is only one call to pace.

Use this for judges that answer in structured values rather than text, or that can answer a whole batch of questions at once.

## Example: Jev (TypeSafe System One) as the judge

[Jev](https://typesafe.ai) answers a map of named yes/no (`noul`) questions in a single request and returns a calibrated probability for each, which maps onto `structuredJudge` directly:

```typescript
import { TypeSafeClient, noul } from "@typesafe-ai/sdk";
import type { NoulQuestion } from "@typesafe-ai/sdk";
import type { RunnerConfig, StructuredJudge } from "agent-regression-testing";

const jev = new TypeSafeClient(); // reads TYPESAFE_API_KEY

const jevJudge: StructuredJudge = async ({ question, response, criteria }) => {
  const questions: Record<string, NoulQuestion> = {};
  criteria.forEach((criterion, i) => {
    questions[`c${i}`] = noul("Does the response satisfy this criterion?", {
      true: criterion,
    });
  });

  const { answers } = await jev.systemOne({ state: { question, response }, questions });

  return criteria.map((_, i) => {
    const answer = answers[`c${i}`];
    if (!answer) throw new Error(`Jev returned no answer for criterion ${i}`);
    return { met: answer.noul >= 0.5, confidence: answer.noul }; // noul is P(yes), 0..1
  });
};

const config: RunnerConfig = {
  ...fileConfig,
  testCases: fileConfig.testCases!,
  agent: async (question) => (await myAgent.generate(question)).text,
  structuredJudge: jevJudge,
};
```

Two things to watch: the SDK retries internally, so leave `retryConfig` unset (or set `maxRetries: 1`) to avoid stacking retries on top of `withRetry`; and Jev returns no reasoning prose, so `reasoning` in the report becomes a confidence figure.
