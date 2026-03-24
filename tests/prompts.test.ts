import { describe, expect, it } from "vitest";
import {
  buildEvaluationPrompt,
  DEFAULT_EVALUATION_PROMPT_EN,
  DEFAULT_EVALUATION_PROMPT_JA,
} from "../src/prompts.js";

describe("buildEvaluationPrompt", () => {
  it("substitutes all template variables", () => {
    const template = "Q: {{question}} R: {{response}} C: {{criterion}}";
    const result = buildEvaluationPrompt(template, {
      question: "What is AI?",
      response: "AI is artificial intelligence.",
      criterion: "Provides a clear definition",
    });
    expect(result).toBe(
      "Q: What is AI? R: AI is artificial intelligence. C: Provides a clear definition",
    );
  });

  it("replaces multiple occurrences of the same variable", () => {
    const template = "{{question}} and {{question}}";
    const result = buildEvaluationPrompt(template, {
      question: "hello",
      response: "world",
      criterion: "test",
    });
    expect(result).toBe("hello and hello");
  });

  it("works with the Japanese default template", () => {
    const result = buildEvaluationPrompt(DEFAULT_EVALUATION_PROMPT_JA, {
      question: "テスト質問",
      response: "テスト回答",
      criterion: "テスト基準",
    });
    expect(result).toContain("テスト質問");
    expect(result).toContain("テスト回答");
    expect(result).toContain("テスト基準");
    expect(result).not.toContain("{{question}}");
    expect(result).not.toContain("{{response}}");
    expect(result).not.toContain("{{criterion}}");
  });

  it("works with the English default template", () => {
    const result = buildEvaluationPrompt(DEFAULT_EVALUATION_PROMPT_EN, {
      question: "What is testing?",
      response: "Testing verifies correctness.",
      criterion: "Is accurate",
    });
    expect(result).toContain("What is testing?");
    expect(result).toContain("Testing verifies correctness.");
    expect(result).toContain("Is accurate");
    expect(result).not.toContain("{{question}}");
  });

  it("leaves template intact when no placeholders match", () => {
    const template = "No placeholders here";
    const result = buildEvaluationPrompt(template, {
      question: "q",
      response: "r",
      criterion: "c",
    });
    expect(result).toBe("No placeholders here");
  });
});
