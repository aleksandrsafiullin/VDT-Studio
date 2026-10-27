type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => !!value && typeof value === "object" && !Array.isArray(value);

/** One model review before publishing a construction question. This supplies
 * no answer or business decision, and cannot execute the proposed action. */
export function localModelQuestionReviewPrompt(prompt: string, output: unknown): string | undefined {
  if (!object(output) || !object(output.action) || output.action.type !== "question" || !Array.isArray(output.action.questions)) return;
  const proposedQuestions = output.action.questions.slice(0, 5).flatMap((question) => object(question) && typeof question.question === "string" ? [{
    question: question.question.slice(0, 500),
    ...(typeof question.reason === "string" ? { reason: question.reason.slice(0, 240) } : {})
  }] : []);
  if (!proposedQuestions.length) return;
  let input: unknown;
  try { input = JSON.parse(prompt); } catch { return; }
  if (!object(input)) return;
  return JSON.stringify({ ...input, hostQuestionReview: {
    proposedQuestions,
    instruction: "Review your proposed question before sending it to the user. This is a host review, NOT a user answer, permission or new fact. First choose questionDisposition: continue_work when you can proceed yourself, or ask_user only for an essential genuinely missing/contradictory business fact or decision. The selected branch enforces the corresponding action type. Compare the question with the original brief and current graph. If the brief already supplies the input or determines the requested scope, continue_work and act on it. If your own plan contradicts that scope, revise it yourself; do not ask the user to approve your error or choose your repair. The existing root already represents the requested KPI: it is implicit in plan.nodes, so plan only its descendants and never include rootNodeId as a planned node. Routine checks, calculation and finish are already authorized. For continue_work return the actual next tool action, never a question saying you will proceed. For ask_user return a genuine question; do not invent an answer, infer consent or bypass Gateway approvals. This review happens once."
  } });
}

/** The model chooses whether information is missing; the wire grammar then
 * prevents a continuation statement being encoded as a user question. */
export function localModelQuestionReviewSchema(schema: unknown): unknown {
  if (!object(schema) || !object(schema.properties) || !object(schema.properties.action) || !Array.isArray(schema.properties.action.anyOf)) {
    throw new Error("Native question review requires a structured turn schema.");
  }
  const actionSchema = schema.properties.action;
  const actions = actionSchema.anyOf as unknown[];
  const branches = (["continue_work", "ask_user"] as const).flatMap((disposition) => {
    const alternatives = actions.filter((action) => object(action) && object(action.properties) && object(action.properties.type)
      && (disposition === "ask_user" ? action.properties.type.const === "question" : ["action_batch", "final"].includes(String(action.properties.type.const))));
    if (!alternatives.length) return [];
    const copy = structuredClone(schema);
    copy.properties = { questionDisposition: { type: "string", const: disposition }, ...copy.properties as JsonObject,
      action: { ...actionSchema, anyOf: structuredClone(alternatives) } };
    copy.required = ["questionDisposition", ...(Array.isArray(copy.required) ? copy.required : [])];
    return [copy];
  });
  return { anyOf: branches };
}

export function restoreLocalModelQuestionReview(output: unknown): JsonObject {
  if (!object(output) || !object(output.action)
    || !(output.questionDisposition === "ask_user" && output.action.type === "question"
      || output.questionDisposition === "continue_work" && ["action_batch", "final"].includes(String(output.action.type)))) {
    throw new Error("Native question review returned an inconsistent disposition and action.");
  }
  const turn = { ...output };
  delete turn.questionDisposition;
  return turn;
}
