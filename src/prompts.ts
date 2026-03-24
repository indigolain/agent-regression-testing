export const DEFAULT_EVALUATION_PROMPT_JA = `あなたはAI応答の評価者です。以下の基準に基づいて、回答が基準を満たしているか判断してください。

質問: {{question}}

回答: {{response}}

評価基準: {{criterion}}

この基準が満たされているかどうかを判断し、以下の形式で回答してください：
MET: [YES/NO]
REASONING: [簡潔な理由を1-2文で]`;

export const DEFAULT_EVALUATION_PROMPT_EN = `You are an AI response evaluator. Based on the criteria below, determine whether the response meets the criteria.

Question: {{question}}

Response: {{response}}

Evaluation Criterion: {{criterion}}

Determine whether this criterion is met and respond in the following format:
MET: [YES/NO]
REASONING: [A concise reason in 1-2 sentences]`;

/**
 * Builds an evaluation prompt by substituting template variables.
 */
export function buildEvaluationPrompt(
  template: string,
  params: { question: string; response: string; criterion: string },
): string {
  return template
    .replace(/\{\{question\}\}/g, params.question)
    .replace(/\{\{response\}\}/g, params.response)
    .replace(/\{\{criterion\}\}/g, params.criterion);
}
