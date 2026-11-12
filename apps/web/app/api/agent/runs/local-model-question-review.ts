import type { LiteralUserQuantity, ModelAgentStructuredTurn } from "@vdt-studio/vdt-agent-runtime";
import { calculationsWithoutPlannedInputs, extractReferencesFromAst, parseFormula } from "@vdt-studio/vdt-core";
import type { localModelWorkingContext } from "./local-model-context";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => !!value && typeof value === "object" && !Array.isArray(value);

type Question = Extract<ModelAgentStructuredTurn["action"], { type: "question" }>["questions"][number];

const confirmation = /(?:\b(?:confirm|approve|approval|may I|can I proceed)\b|подтверж|подтверд|согласу|готовы ли вы|можно ли продолжить)/iu;
const routineStep = /(?:план(?:а)? (?:разложения|декомпозиции)|завершить (?:расч[её]т|построение)|сформировать финальн|run\.request_finish|\b(?:decomposition plan|proceed with (?:the )?(?:build|calculation|plan)|finish the (?:calculation|tree)|generate the final report)\b)/iu;
const contextConfirmation = /^(?:confirm_(?:inputs?|brief|details|parameters|period|currency)|(?:inputs?|period|currency)_confirmation|period_currency)$/i;
const rootDesign = /^root(?:_kpi)?_(?:formula|status|baseline|value)(?:_confirm)?$/i;
const calculationField = /^(.+)_(?:formula|link|parent|references?|operands?)(?:_confirm)?$/i;
const rootEntry = /^(?:\s*(?:enter|provide|set|specify)\s+(?:the\s+)?(?:formula|baseline)\s+(?:for|of)\s+(?:the\s+)?root(?:\s+kpi)?|\s*(?:введите|укажите|задайте)\s+(?:формулу|базовое значение)\s+корневого\s+(?:KPI|показателя))[.!]?\s*$/iu;
const formulaEntry = /^\s*(?:(?:confirm|specify|provide|enter|set)\b.{0,80}\bformula\b|(?:подтвердите|укажите|задайте).{0,80}формул)/iu;
const directReference = /(?:\bdirectly reference\b|\breference\b.{1,80}\bdirectly\b|ссылаться напрямую|прям[а-яё]* ссылк)/iu;
const unfinishedFormula = /(?:\b(?:missing formula|no formula|formula backlog|formula is missing|placeholder)\b|нет формулы|формул\p{L}* отсутств|формул\p{L}* ещё не задан)/iu;
const toolSyntaxQuestion = /\b(?:formula syntax|assignment syntax|parentheses allowed|syntax for the formula)\b|синтаксис формул|можно ли (?:использовать|ставить) скобки/iu;
const hierarchyRepairCodes = ["PARENT_FORMULA_MISMATCH", "WRONG_VISUAL_PARENT", "UNDECLARED_FORMULA_DEPENDENCY"];

function numericTargets(question: Question): string[] {
  if (question.fields?.length) return question.fields.every((field) => field.kind === "number")
    ? question.fields.map((field) => field.id) : [];
  return question.expectedAnswerType === "number" || question.answerKind === "number" ? [question.id] : [];
}

function specificChoices(question: Question): string[] {
  return (question.options ?? []).map((option) => typeof option === "string" ? option : option.label)
    .filter((text) => !/^\s*(?:other\b|другой вариант(?:\s|$|[(:]))/iu.test(text));
}

function offersMechanicalFormulas(choices: string[], knownIds: ReadonlySet<string>, needsPlanRepair: boolean): boolean {
  if (choices.length < 2) return false;
  try {
    const formulas = choices.map((choice) => parseFormula(choice.replace(/^\s*[a-z_][a-z_0-9]*\s*=\s*/iu, "")));
    const references = formulas.map((formula) => extractReferencesFromAst(formula).map((id) => id.toLowerCase()));
    if (!references.every((ids) => ids.some((id) => knownIds.has(id)))
      || !references.some((ids) => ids.every((id) => knownIds.has(id)))) return false;
    // An operandless placeholder needs a plan repair. Otherwise distinct
    // expressions can represent a real policy choice, even as equations.
    if (needsPlanRepair) return true;
    const expressions = formulas.map((formula) => formula.type === "binary" && (formula.operator === "+" || formula.operator === "*")
      ? JSON.stringify([formula.operator, [JSON.stringify(formula.left), JSON.stringify(formula.right)].sort()])
      : JSON.stringify(formula));
    return expressions.every((expression) => expression === expressions[0]);
  } catch {
    return false;
  }
}

/** Omit redundant questions and prioritize entering known source values once.
 * The latter orders actions without assigning a quote to a model-authored KPI. */
export function constructionQuestionReview(
  questions: Question[], brief: JsonObject | undefined,
  observation: ReturnType<typeof localModelWorkingContext>, facts: readonly LiteralUserQuantity[] | undefined
) {
  const leafIds = new Set(observation.inputLeafIds);
  const sourcedIds = new Set<string>();
  const sourcedValues = new Set<number>();
  for (const [id, , , , , baseline, value, status] of observation.nodes) {
    const amount = baseline ?? value;
    if (typeof id !== "string" || !leafIds.has(id) || typeof amount !== "number" || !Number.isFinite(amount)
      || status !== "user_provided_value") continue;
    sourcedIds.add(id);
    sourcedValues.add(amount);
  }
  const factValues = new Set(facts?.map((fact) => fact.value));
  const userScope = [brief?.prompt, brief?.businessContext, brief?.rootKpi, brief?.unit, brief?.timePeriod]
    .filter((field): field is string => typeof field === "string").join(" ").toLowerCase();
  const scopeWords = new Set(userScope.match(/[\p{L}\p{N}]+/gu));
  const formulaBacklog = new Set(observation.formulaBacklog.nodes.map(({ id }) => id.toLowerCase()));
  const calculationIds = new Set([
    observation.rootNodeId,
    ...(observation.decompositionPlan?.nodes.filter(({ kind }) => kind === "calculated").map(({ nodeId }) => nodeId) ?? [])
  ].map((id) => id.toLowerCase()));
  const knownIds = new Set([...observation.nodes.map(([id]) => String(id).toLowerCase()),
    ...(observation.decompositionPlan?.nodes.map(({ nodeId }) => nodeId.toLowerCase()) ?? [])]);
  const operandlessCalculations = new Set(calculationsWithoutPlannedInputs(observation.decompositionPlan).map((id) => id.toLowerCase()));
  const remaining = questions.filter((question) => {
    const text = question.question;
    const id = question.id.toLowerCase().replace(/-/g, "_");
    if (confirmation.test(text) && (routineStep.test(text) || /^confirm_(?:decomposition_)?plan$/.test(id))) return false;
    if (rootDesign.test(id) && rootEntry.test(text)) return false;
    const targets = numericTargets(question);
    if (!targets.length && !question.fields?.length && toolSyntaxQuestion.test(text)) return false;
    if (targets.length && targets.every((target) => sourcedIds.has(target))) return false;
    const calculationId = calculationField.exec(id)?.[1];
    if (calculationId && !targets.length && !question.fields?.length) {
      const choices = specificChoices(question);
      if (formulaBacklog.has(calculationId) && formulaEntry.test(text) && unfinishedFormula.test(question.reason)
        && offersMechanicalFormulas(choices, knownIds, operandlessCalculations.has(calculationId))) return false;
      if (calculationIds.has(calculationId) && directReference.test(text) && choices.length > 1
        && choices.every((choice) => {
          const reference = /^\s*(?:reference|ссылаться на)\s+([a-z_][a-z_0-9]*)\b/iu.exec(choice)?.[1];
          return reference && knownIds.has(reference.toLowerCase());
        }) && hierarchyRepairCodes.some((code) =>
        question.reason.includes(code) && observation.hierarchy.errors.some((error) =>
          error.toLowerCase().startsWith(`${code.toLowerCase()}: ${calculationId} `)))) return false;
    }
    if (facts && !question.fields?.length && !targets.length && confirmation.test(text) && contextConfirmation.test(id)) {
      const amounts = [...text.matchAll(/[-+]?\d+(?:[.,]\d+)?/g)].map(([value]) => Number(value.replace(",", ".")));
      const currencies = text.match(/\b(?:USD|EUR|GBP|KZT|RUB|CAD|AUD|JPY|CNY|CHF)\b/gi) ?? [];
      const statedScope = [...text.matchAll(/(?:валюта|currency|период|period)\s*(?:[:=]|\()\s*([\p{L}\p{N}]+)/giu)];
      const hasKnownScope = currencies.length > 0 || [brief?.rootKpi, brief?.timePeriod].some((value) =>
        typeof value === "string" && text.toLowerCase().includes(value.toLowerCase()));
      if (hasKnownScope && currencies.every((value) => scopeWords.has(value.toLowerCase()))
        && statedScope.every(([, value]) => scopeWords.has(value!.toLowerCase()))
        && amounts.every((value) => factValues.has(value) || scopeWords.has(String(value)))) return false;
    }
    return true;
  });
  const enterKnownFacts = !observation.truncated && observation.unfilledInputCount > 0 && remaining.length > 0
    && remaining.every((question) => numericTargets(question).length > 0)
    && !!facts?.some(({ value }) => !sourcedValues.has(value));
  return { remaining, enterKnownFacts };
}

export const CONSTRUCTION_QUESTION_CHECK = [
  "Decide which proposed questions need a genuine user answer before the requested business calculation can proceed.",
  "Keep a question only if the request and current evidence leave an essential external fact or business choice unresolved.",
  "A value, unit, period, exclusion or order of operations already stated by the user is settled. An alternative that contradicts it needs no confirmation.",
  "The agent authors the factor structure and formulas, resolves tool and graph errors, records supplied inputs, and reports the verified result. These implementation steps and routine approvals are not user questions.",
  "Return required as the list of 1-based indexes of the questions that need a user answer. Return an empty list if the agent can proceed."
].join(" ");

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
