import { z } from "zod";

export const STRUCTURAL_RELATIONSHIP_PROMPT = [
  "Assess only whether the user has left a material business relationship unresolved for the requested model structure.",
  "Use the scope and KPI unit the user actually specified. A rate is already expressed on its stated time basis. Do not infer a reporting period, additional operations, an industry, or unavailable measurements.",
  "If distinct plausible relationships would change the formula, ask one plain-language question about what happens in the real process. Ask about the relationship itself. Do not propose a formula, ask the user to approve a plan, collect measurement values, or select a skill.",
  "Write the question and its short reason in the user's language, respecting explicit response-language instructions. Return question=null if the relationship is stated, confirmed in the provided context, or immaterial. Never answer the question on the user's behalf."
].join(" ");

export const structuralRelationshipAssessmentSchema = z.object({
  question: z.object({ text: z.string().trim().min(1).max(500), reason: z.string().trim().min(1).max(240) }).strict().nullable()
}).strict();

export const OLLAMA_STRUCTURAL_RELATIONSHIP_PROMPT = [
  "Determine whether the user's requested model needs a question about how its parts work together.",
  "Use unresolved and ask one plain-language question when the description leaves materially different relationships open. Labels such as stages, lines and steps do not say whether all work goes through them in order, they run independently, or they share a constraint. The overall rate can depend on that distinction even when the rates are unknown.",
  "Use stated only when you can quote exact user words that describe the actual relationship. Use immaterial when the open relationship cannot change the requested model. A common or likely arrangement is insufficient evidence for stated.",
  "For unresolved, ask how the real process works in the user's language. Ask about the relationship itself. Leave formulas, measurements, planning and guidance selection to later steps."
].join(" ");

const explanation = z.string().trim().min(1).max(240);
export const ollamaRelationshipAssessmentSchema = z.discriminatedUnion("relationship", [
  z.object({ relationship: z.literal("unresolved"), question: structuralRelationshipAssessmentSchema.shape.question.unwrap() }).strict(),
  z.object({ relationship: z.literal("stated"), userQuote: explanation }).strict(),
  z.object({ relationship: z.literal("immaterial"), reason: explanation }).strict()
]);

export function ollamaRelationshipDecision(assessment: unknown, source: readonly unknown[]) {
  const checked = ollamaRelationshipAssessmentSchema.safeParse(assessment);
  if (!checked.success) return;
  const decision = checked.data;
  if (decision.relationship === "stated"
    && !source.some(value => typeof value === "string" && value.includes(decision.userQuote))) return;
  return { question: decision.relationship === "unresolved" ? decision.question : null };
}

export function structuralRelationshipQuestion(exchangeId: string, assessment: unknown) {
  const { question } = structuralRelationshipAssessmentSchema.parse(assessment);
  if (!question) return undefined;
  return {
    turnId: exchangeId,
    sessionState: "Structural relationship question submitted. Use the user's actual answer before choosing the model relationship.",
    assistantMessage: null,
    action: {
      type: "question" as const, messageId: `${exchangeId}:relationship`, questionSetId: `${exchangeId}:relationships`,
      questions: [{
        id: "process_relationship", question: question.text, reason: question.reason, required: true,
        expectedAnswerType: "text" as const, answerKind: "text" as const
      }]
    }
  };
}
