import { createHash } from "node:crypto";
import type { AppleGuidedField } from "@vdt-studio/local-runner/apple-foundation-models";
import {
  decompositionRelationshipUnit,
  hasTypedDecompositionRelationship,
  inspectDecompositionHierarchy,
  parseFormula,
  plannedAdditionCandidates,
  plannedFormulaTargets,
  readDecompositionAssumptions,
  type QuantityRateDecompositionRelationship,
  type VdtNode,
  type VdtProject
} from "@vdt-studio/vdt-core";
import { defaultProgressiveBuildPolicy, type LiteralUserQuantity } from "@vdt-studio/vdt-agent-runtime";
import { z, ZodError } from "zod";

const text = { kind: "string" } as const;
const limit = defaultProgressiveBuildPolicy.maxNodesPerLayer;
const maxUnitLength = 80;
const maxPlanGoalLength = 500;
const maxPlanRationaleLength = 300;
export const compactPlanSizeInstruction = `Use at most ${maxPlanGoalLength} characters for goal, ${limit} nodes, and ${maxPlanRationaleLength} characters per rationale.`;

export function compactPlanSizeFailure(error: unknown): "PLAN_GOAL_TOO_LONG" | "PLAN_TOO_MANY_NODES" | "PLAN_RATIONALE_TOO_LONG" | undefined {
  if (!(error instanceof ZodError) || error.issues.length !== 1) return;
  const [issue] = error.issues;
  if (issue?.code !== "too_big") return;
  const [field, index, child] = issue.path;
  if (issue.path.length === 1) {
    if (field === "goal" && issue.origin === "string" && issue.maximum === maxPlanGoalLength) return "PLAN_GOAL_TOO_LONG";
    if (field === "nodes" && issue.origin === "array" && issue.maximum === limit) return "PLAN_TOO_MANY_NODES";
  }
  if (issue.path.length === 3 && field === "nodes" && typeof index === "number" && child === "rationale"
    && issue.origin === "string" && issue.maximum === maxPlanRationaleLength) return "PLAN_RATIONALE_TOO_LONG";
}

const toolForPhase = {
  draft: "vdt.create_draft",
  unit: "vdt.update_node",
  plan: "vdt.set_decomposition_plan",
  add: "vdt.add_drivers_batch",
  fill: "vdt.fill_input_values_batch",
  formula: "vdt.set_formula",
  finish: "run.request_finish"
} as const;

const question: AppleGuidedField = { name: "focusedQuestion", shape: { kind: "object", fields: [
  { name: "question", shape: text }, { name: "reason", shape: text }
] } };

const payloadForPhase: Partial<Record<keyof typeof toolForPhase, AppleGuidedField>> = {
  draft: { name: "draft", shape: { kind: "object", fields: [
    { name: "projectTitle", shape: text }, { name: "rootKpi", shape: text },
    { name: "unit", shape: text, optional: true }, { name: "timePeriod", shape: text, optional: true }
  ] } },
  unit: { name: "unit", shape: text },
  plan: { name: "plan", shape: { kind: "object", fields: [
    { name: "goal", shape: text, description: `State the plan goal in at most ${maxPlanGoalLength} characters.` },
    { name: "nodes", shape: { kind: "array", maxItems: limit, element: { kind: "object", fields: [
      { name: "nodeId", shape: text, description: "Choose a stable ASCII snake_case identifier for a direct editable input. Never repeat the existing output." },
      { name: "rationale", shape: text, optional: true, description: `Explain why this input is an operand in at most ${maxPlanRationaleLength} characters.` }
    ] } } }
  ] } },
  add: { name: "drivers", shape: { kind: "array", maxItems: limit, element: { kind: "object", fields: [
    { name: "nodeId", shape: text, description: "Copy one missing planned node ID exactly." },
    { name: "name", shape: text, description: "Editable measure name in the user's language." },
    { name: "unit", shape: text, optional: true }
  ] } } },
  formula: { name: "formula", shape: text, description: "Copy operands from the Existing direct operands list exactly. The expression must contain all their IDs and no other IDs. No headings or assignment." }
};

const instructions = {
  draft: "Create the requested root KPI. Preserve the user's scope, period, and unit. Ask a focused question if a material fact is missing.",
  unit: "Set the existing root's unit using the submitted scope. Keep the rate denominator if the requested output is a rate. Inspect the hierarchy if the unit cannot be established.",
  plan: `Derive the final output at the existing root. Do not add a node for the root or a duplicate of its output. Plan only the complete layer of 2–${limit} direct editable input operands, using the submitted scope and selected method. Ask only if an unresolved business relationship would change the formula. Use vdt.inspect_hierarchy for a nested, calculated, context, shared, measured, or larger hierarchy that needs the full construction tools.`,
  add: "Add all listed missing direct inputs as one blank layer. Use the exact planned IDs, and choose meaningful names and units using the submitted scope and selected method. Preserve any stated per-item denominator even when the value stays blank. For example, count multiplied by h/item yields h; use count for the quantity and h/item for the per-item duration.",
  fill: "Match each existing blank input to exactly one quoted measurement. Copy only the offered node IDs and quantity IDs. Do not assign a value based on ordering or a similar unit. Inspect the hierarchy if one quote is contextual, one input needs another source, or the direct layer is incomplete.",
  formula: "Return one plain root expression using the business relationship established by the user. Copy each listed existing operand ID exactly. Use plain formula syntax with identifiers, arithmetic operators such as *, and function calls such as min(a, b). Do not use braces, display names, assignments or invented IDs. Check the operand units against the root unit. Ask if the relationship remains material and unresolved.",
  finish: "Request host-verified structural finish. The host checks the current graph and saved workspace."
} satisfies Record<keyof typeof toolForPhase, string>;

export interface AppleNativeStructuralGuide {
  readonly phase: keyof typeof toolForPhase;
  readonly names: readonly string[];
  readonly payloads: ReadonlyMap<string, AppleGuidedField>;
  readonly instruction: string;
  readonly rootNodeId: string;
  readonly missingNodeIds: readonly string[];
  readonly measured?: {
    readonly quantities: readonly (LiteralUserQuantity & { id: string })[];
    readonly operands: readonly Pick<VdtNode, "id" | "name" | "unit">[];
  };
  readonly planRoot?: Pick<VdtNode, "id" | "name" | "unit">;
  readonly savedQuantityRate?: QuantityRateDecompositionRelationship;
  readonly productLayer?: {
    root: Pick<VdtNode, "id" | "name" | "unit" | "formula">;
    planned: readonly { nodeId: string; rationale?: string }[];
    operands: readonly Pick<VdtNode, "id" | "name" | "unit">[];
  };
  readonly formulaProbe?: { root: VdtNode; operands: readonly [VdtNode, VdtNode]; unit: string };
}

export function boundedMeasuredFacts(quantities: readonly LiteralUserQuantity[]): readonly LiteralUserQuantity[] | undefined {
  const facts = quantities.filter(quantity => quantity.unit || /\p{Nd}/u.test(quantity.quote));
  if (facts.length > limit || facts.length === 1
    || facts.some(({ value, quote }) => !Number.isFinite(value) || quote.length < 4 || quote.length > 160)
    || new Set(facts.map(({ quote }) => quote)).size !== facts.length) return;
  return facts;
}

export function guide(project: VdtProject, measurements: readonly LiteralUserQuantity[] = []): AppleNativeStructuralGuide | undefined {
  const nodes = project.graph.nodes;
  const root = nodes.find(node => node.id === project.rootNodeId);
  const facts = measurements.map((fact, index) => ({ ...fact, id: `q${index + 1}` }));
  const measured = facts.length > 0;
  if (measured && facts.length < 2 || facts.length > limit) return;
  const typedNotes = root?.assumptions?.filter(hasTypedDecompositionRelationship) ?? [];
  const savedRelationship = typedNotes.length === 1
    ? readDecompositionAssumptions({ assumptions: typedNotes })[0]?.relationship : undefined;
  // Let the shared readiness/repair path handle invalid durable evidence.
  if (typedNotes.length && !savedRelationship) return;
  const savedQuantityRate = savedRelationship?.kind === "quantity_rate" ? savedRelationship : undefined;
  let phase: AppleNativeStructuralGuide["phase"];
  let missingNodeIds: readonly string[] = [];
  let operandContext = "";
  let formulaProbe: AppleNativeStructuralGuide["formulaProbe"];
  let measuredOperands: readonly Pick<VdtNode, "id" | "name" | "unit">[] = [];
  if (!nodes.length) phase = "draft";
  else {
    if (root?.type !== "root_kpi" || root.value != null || root.baselineValue != null
      || (measured && (root.goalSeek || root.scenarioValue != null))) return;
    const plan = root.decompositionPlan;
    if (!plan) {
      if (nodes.length !== 1 || root.formula?.trim()) return;
      phase = measured && !root.unit?.trim() ? "unit" : "plan";
    } else {
      if (plan.nodes.length < 2 || plan.nodes.length > limit || plan.nodes.some(node =>
        node.parentNodeId !== root.id || node.kind !== "input" || node.sharedWith?.length)) return;
      if (measured && (plan.nodes.length !== facts.length || !root.unit?.trim())) return;
      const plannedIds = new Set(plan.nodes.map(node => node.nodeId));
      const operands = nodes.filter(node => node.id !== root.id);
      if (operands.some(node => !plannedIds.has(node.id) || node.type !== "input" || node.formula?.trim())) return;
      const remainingFacts = new Set(facts);
      const blank = operands.filter(node => node.value == null && node.baselineValue == null && node.scenarioValue == null);
      for (const operand of operands) {
        if (blank.includes(operand)) continue;
        const bound = operand.valueStatus === "user_provided_value" && facts.find(fact => remainingFacts.has(fact)
          && fact.value === (operand.baselineValue ?? operand.value) && fact.quote === operand.valueSource?.note);
        if (!bound) return;
        remainingFacts.delete(bound);
      }
      missingNodeIds = plannedAdditionCandidates(project).map(node => node.nodeId);
      if (missingNodeIds.length >= 2 && !root.formula?.trim()) phase = "add";
      else if (missingNodeIds.length || !plannedFormulaTargets(project).includes(root.id)) return;
      else if (measured && blank.length) {
        // The typed batch is atomic. A mixed or externally filled layer goes
        // through normal reconciliation rather than projecting a partial fill.
        const edges = project.graph.edges;
        if (blank.length !== operands.length || root.formula?.trim() || edges.length !== operands.length
          || operands.some(node => edges.filter(edge => edge.sourceNodeId === root.id
            && edge.targetNodeId === node.id && edge.relation === "formula_dependency").length !== 1)) return;
        measuredOperands = blank.map(({ id, name, unit }) => ({ id, name, unit }));
        phase = "fill";
      }
      else if (plannedFormulaTargets(project, true).includes(root.id)) {
        phase = "formula";
        const boundedUnit = (unit: VdtNode["unit"]) => unit && unit.length <= maxUnitLength ? unit : null;
        operandContext = `Root unit and existing direct operands (copy the ids): ${JSON.stringify({
          rootUnit: boundedUnit(root.unit), operands: operands.map(({ id, name, unit }) => ({ id, name, unit: boundedUnit(unit) }))
        })}`;
        const [first, second] = operands;
        const basis = decompositionRelationshipUnit(root.unit);
        if (operands.length === 2 && first && second) {
          const legacyUnit = root.unit && basis && !root.goalSeek && root.status !== "rejected"
            && operands.every(node => !node.goalSeek && node.status !== "rejected" && decompositionRelationshipUnit(node.unit) === basis)
            ? root.unit : undefined;
          const unit = savedQuantityRate?.unit ?? legacyUnit;
          if (unit) formulaProbe = { root: structuredClone(root), operands: [structuredClone(first), structuredClone(second)], unit };
        }
      }
      else if (inspectDecompositionHierarchy(project).valid) phase = "finish";
      else return;
    }
  }
  const tool = toolForPhase[phase];
  const payload: AppleGuidedField | undefined = phase === "fill" ? { name: "bindings", shape: {
    kind: "array", maxItems: limit, element: { kind: "object", fields: [
      { name: "nodeId", shape: { kind: "choice", choices: measuredOperands.map(({ id }) => id) } },
      { name: "quantityId", shape: { kind: "choice", choices: facts.map(({ id }) => id) } }
    ] }
  } } : payloadForPhase[phase];
  const names: string[] = [tool];
  const payloads = new Map<string, AppleGuidedField>();
  if (phase !== "finish") {
    names.push("user.ask");
    payloads.set("user.ask", question);
  }
  if (phase === "plan" || phase === "unit" || phase === "fill") names.push("vdt.inspect_hierarchy");
  if (payload) payloads.set(tool, payload);
  const productLayer = !measured && root?.decompositionPlan?.nodes.length === 2 && (phase === "add" || phase === "formula" || phase === "finish")
    ? {
      root: { id: root.id, name: root.name, unit: root.unit, formula: root.formula },
      planned: root.decompositionPlan.nodes.map(({ nodeId, rationale }) => ({ nodeId, ...(rationale ? { rationale } : {}) })),
      operands: nodes.filter(node => node.id !== root.id).map(({ id, name, unit }) => ({ id, name, unit }))
    } : undefined;
  const instruction = measured && phase === "plan"
    ? `Plan exactly ${facts.length} direct editable inputs, one for each quoted measurement. Keep the existing root. Inspect the hierarchy if any quote is contextual or the requested model needs other inputs, calculated subtotals or shared factors.`
    : instructions[phase];
  const measuredContext = measured && (phase === "fill" || phase === "plan")
    ? `\nQuoted measurements: ${JSON.stringify(facts)}${phase === "fill" ? `\nBlank inputs: ${JSON.stringify(measuredOperands)}` : ""}` : "";
  return { phase, names, payloads, instruction: `${instruction}${operandContext ? `\n${operandContext}` : ""}${measuredContext}`,
    rootNodeId: project.rootNodeId, missingNodeIds,
    ...(measured ? { measured: { quantities: facts, operands: measuredOperands } } : {}),
    ...(phase === "plan" && root ? { planRoot: { id: root.id, name: root.name, unit: root.unit } } : {}),
    ...(savedQuantityRate ? { savedQuantityRate } : {}), ...(productLayer ? { productLayer } : {}), ...(formulaProbe ? { formulaProbe } : {}) };
}

export function repairFormulaGuide(structuralGuide: AppleNativeStructuralGuide, code: string): AppleNativeStructuralGuide {
  if (structuralGuide.phase !== "formula") return structuralGuide;
  const correction = code === "MISSING_FORMULA_REFERENCES"
    ? "Replace missing references by copying the exact IDs from Existing direct operands. Keep the confirmed relationship and units."
    : code === "FORMULA_PARSE_ERROR"
      ? "Correct the previous expression using the formula parser diagnostic. Return only a single valid expression with the exact planned input IDs. Keep the confirmed relationship and units."
      : undefined;
  return correction ? { ...structuralGuide, names: ["vdt.set_formula"],
    instruction: `${correction}\n${structuralGuide.instruction}` } : structuralGuide;
}

const id = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(160);
const line = (max: number) => z.string().trim().min(1).max(max);
const draft = z.object({ projectTitle: line(240), rootKpi: line(200), unit: line(maxUnitLength).nullish(), timePeriod: line(80).nullish() }).strict();
const plan = z.object({ goal: line(maxPlanGoalLength), nodes: z.array(z.object({
  nodeId: id, rationale: line(maxPlanRationaleLength).nullish()
}).strict()).min(2).max(limit) }).strict();
const drivers = z.array(z.object({
  nodeId: id, name: line(200), unit: line(maxUnitLength).nullish()
}).strict()).min(2).max(limit);
const focusedQuestion = z.object({ question: line(500), reason: line(600) }).strict();
const measuredBindings = z.array(z.object({ nodeId: id, quantityId: id }).strict()).min(2).max(limit);

export function projectArguments(
  structuralGuide: AppleNativeStructuralGuide,
  name: string,
  action: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  if (!structuralGuide.names.includes(name)) throw new Error("Ineligible structural action.");
  const payload = structuralGuide.payloads.get(name);
  if (action.tool !== name || Object.keys(action).length !== (payload ? 2 : 1)
      || (payload && !Object.hasOwn(action, payload.name))) throw new Error("Invalid structural action.");
  if (name === "user.ask") {
    const args = focusedQuestion.parse(action.focusedQuestion);
    const questionId = createHash("sha256").update(JSON.stringify([structuralGuide.phase, args.question])).digest("hex").slice(0, 16);
    return { questions: [{ id: `structural_scope_${questionId}`, ...args, required: true, expectedAnswerType: "text" }] };
  }
  if (name === "vdt.inspect_hierarchy") return {};
  const { rootNodeId } = structuralGuide;
  switch (structuralGuide.phase) {
    case "draft": {
      const { projectTitle, rootKpi, unit, timePeriod } = draft.parse(action.draft);
      return { projectTitle, rootKpi, ...(unit ? { unit } : {}), ...(timePeriod ? { timePeriod } : {}) };
    }
    case "unit":
      return { nodeId: rootNodeId, patch: { unit: line(maxUnitLength).parse(action.unit) } };
    case "plan": {
      const { goal, nodes } = plan.parse(action.plan);
      const rootEcho = nodes.filter(node => node.nodeId === rootNodeId);
      const descendants = nodes.filter(node => node.nodeId !== rootNodeId);
      if (rootEcho.length > 1 || descendants.length < 2) {
        throw new Error("Plan at least two direct editable inputs of the existing root.");
      }
      if (structuralGuide.measured && (rootEcho.length || descendants.length !== structuralGuide.measured.quantities.length)) {
        throw new Error("Plan one direct input for every offered measurement or inspect the hierarchy.");
      }
      return { plan: { version: 1, goal, nodes: descendants.map(({ nodeId, rationale }) => ({
        nodeId, parentNodeId: rootNodeId, kind: "input", ...(rationale ? { rationale } : {})
      })) } };
    }
    case "fill": {
      const measured = structuralGuide.measured!;
      const bindings = measuredBindings.parse(action.bindings);
      const expected = new Set(measured.operands.map(({ id }) => id));
      const facts = new Map(measured.quantities.map(fact => [fact.id, fact]));
      if (bindings.length !== expected.size || bindings.length !== facts.size) throw new Error("Bind the complete measured layer.");
      return { values: bindings.map(({ nodeId, quantityId }) => {
        const fact = facts.get(quantityId);
        if (!expected.delete(nodeId) || !fact || !facts.delete(quantityId)) throw new Error("Use each offered input and quote once.");
        return { nodeId, value: fact.value, provenance: "user_provided_value", note: fact.quote };
      }) };
    }
    case "add": {
      const additions = drivers.parse(action.drivers);
      const expected = new Set(structuralGuide.missingNodeIds);
      if (additions.length !== expected.size || additions.some(({ nodeId }) => !expected.delete(nodeId))) {
        throw new Error("Add the exact missing planned layer.");
      }
      return { drivers: additions.map(({ nodeId, name, unit }) => ({
        nodeId, name, parentNodeId: rootNodeId, type: "input", relation: "formula_dependency", ...(unit ? { unit } : {})
      })) };
    }
    case "formula": {
      const value = line(500).parse(action.formula);
      const fenced = /^```(?:formula)?[ \t]*\r?\n([^`]+)\r?\n```$/.exec(value);
      const expression = (fenced?.[1] ?? value).trim();
      const assignment = expression.indexOf("=");
      const formula = assignment >= 0 && expression.slice(0, assignment).trim() === rootNodeId
        ? expression.slice(assignment + 1).trim()
        : expression;
      if (formula !== value) {
        try {
          parseFormula(formula);
          return { nodeId: rootNodeId, formula };
        } catch {
          // Keep the original so the Gateway can issue its canonical diagnostic.
        }
      }
      return { nodeId: rootNodeId, formula: value };
    }
    case "finish":
      return {};
  }
}
