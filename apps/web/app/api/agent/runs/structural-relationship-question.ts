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

export const OLLAMA_STRUCTURAL_RELATIONSHIP_REVIEW_PROMPT = [
  "Independently review whether the draft question is necessary to build the model requested in the literal user brief. The draft question and its reason are unverified, not additional facts.",
  "Choose stated if the user already supplied the relationship or basis. Choose out_of_scope if the requested model does not depend on the proposed distinction. For either choice use an exact supporting quote from the brief. Choose a grounded suppression even if the question misstates a value when the user's wording settles what it asks.",
  "Choose material only if the same original question and reason contain no invented or contradictory facts and distinguish two unresolved, plausible real-world arrangements that change the requested model. Quote two distinct, nonoverlapping phrases from the original question that describe those arrangements. Cite the exact user wording that supports the relevant process and scope.",
  "Choose unsupported if the draft itself contains an error, changes the requested KPI or horizon, asks for later measurements, or cannot be justified from the submitted brief. Never rewrite the question or choose a Skill."
].join(" ");

const reviewAlternative = z.string().trim().min(1).max(120);
export const ollamaRelationshipReviewSchema = z.discriminatedUnion("disposition", [
  z.object({ disposition: z.literal("material"), userQuote: explanation,
    alternatives: z.array(reviewAlternative).length(2) }).strict(),
  z.object({ disposition: z.literal("stated"), userQuote: explanation }).strict(),
  z.object({ disposition: z.literal("out_of_scope"), userQuote: explanation }).strict(),
  z.object({ disposition: z.literal("unsupported") }).strict()
]);

export function ollamaRelationshipReview(review: unknown, draft: NonNullable<z.infer<typeof structuralRelationshipAssessmentSchema>["question"]>,
  source: readonly unknown[]): "show" | "continue" | "discard" | "hold" {
  const checked = ollamaRelationshipReviewSchema.safeParse(review);
  const evidence = source.filter((value): value is string => typeof value === "string");
  if (!checked.success) return "hold";
  const decision = checked.data;
  if (decision.disposition === "unsupported") return "discard";
  if (!evidence.some(text => text.includes(decision.userQuote))) return "hold";
  if (decision.disposition !== "material") return "continue";
  const [first, second] = decision.alternatives;
  const appearsBefore = (left: string, right: string) => {
    const start = draft.text.indexOf(left);
    return start >= 0 && draft.text.includes(right, start + left.length);
  };
  if (!first || !second || first.toLowerCase() === second.toLowerCase()
    || (!appearsBefore(first, second) && !appearsBefore(second, first))) return "hold";
  // A question can name supplied values, but it must not introduce a fresh
  // numeric claim before the plan or calculator has verified anything.
  const numerals = (text: string) => text.match(/[+-]?\p{Nd}+(?:[.,]\p{Nd}+)*/gu) ?? [];
  const submittedNumerals = new Set(evidence.flatMap(numerals));
  return numerals(`${draft.text}
${draft.reason}`).every(value => submittedNumerals.has(value)) ? "show" : "hold";
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
