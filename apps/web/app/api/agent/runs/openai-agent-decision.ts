import { getRegisteredJsonSchema } from "@vdt-studio/model-bridge";
import type { AgentDecisionContext, LiteralUserQuantity } from "@vdt-studio/vdt-agent-runtime";
import {
  calculationsWithoutPlannedInputs, constructionNodeUpdateTypes, decompositionPlanErrors, decompositionPlanGroupingErrors,
  plannedAdditionCandidates, plannedFactorNodeTypes, plannedFactorTypeConflicts, plannedFormulaTargets, plannedOrphanLinks,
  type VdtDecompositionPlan, type VdtNodeType, type VdtProject
} from "@vdt-studio/vdt-core";
import { boundConstructionArguments, groundExistingIds, groundLiteralValues, groundNodeIds } from "./local-model-output-schema";
import type { HierarchyRepairCall } from "./openai-hierarchy-repair";

type JsonObject = Record<string, unknown>;
const record = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const object = (properties: JsonObject): JsonObject => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false
});
const tag = (value: string): JsonObject => ({ type: "string", const: value });
const nativeTools = new Set([
  "vdt.create_draft", "vdt.set_decomposition_plan", "vdt.add_driver", "vdt.add_drivers_batch",
  "vdt.fill_input_values_batch", "vdt.update_node", "vdt.set_formula", "vdt.inspect_hierarchy",
  "vdt.reparent_branch", "vdt.delete_node",
  "vdt.validate", "vdt.calculate", "project.get_node", "project.get_current", "project.read_current",
  "skill.list", "skill.read", "skill.search", "skill.select", "skill.report_gap",
  "tools.describe", "run.request_finish"
]);
const statusMessage = { type: "string", minLength: 1, maxLength: 500 };
const decisions = getRegisteredJsonSchema("agent-decision-v2").anyOf as Array<{ properties: JsonObject }>;
const questionSchema = decisions.find((branch) => "questions" in branch.properties)!;
const finishSchema = decisions.find((branch) => "summary" in branch.properties)!;
const newDriverId = "^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$";

/** Project the existing AgentDecision and closed tool contracts to the strict
 * response schema. Open record tools keep their existing encoded arguments. */
export function buildOpenAiAgentDecision(input: unknown) {
  if (!record(input) || !Array.isArray(input.availableTools) || !input.availableTools.length) return undefined;
  const context = input as unknown as AgentDecisionContext;
  const typed = new Map<string, JsonObject>();
  const choices: JsonObject[] = [];
  const encoded: string[] = [];
  const current = context.currentProject?.truncated === false ? context.currentProject : undefined;
  const ids = current?.nodes.map((node) => node.id) ?? [];
  const leaves = current?.nodes.filter((node) => node.id !== current.rootNodeId && !node.formula?.trim()
    && node.type !== "calculated" && node.type !== "root_kpi" && !node.childIds.length) ?? [];
  const leafIds = leaves.map((node) => node.id);
  const unfilled = leaves.filter((node) => !Number.isFinite(node.baselineValue ?? node.value)).map((node) => node.id);
  const literalOnly = context.mode === "generate_vdt" && context.literalUserQuantitiesComplete === true
    && !Object.keys(context.userAnswers ?? {}).length && !!context.literalUserQuantities?.length;
  for (const tool of context.availableTools) {
    if (current && tool.name === "vdt.fill_input_values_batch" && !unfilled.length) continue;
    const schema = nativeTools.has(tool.name) && record(tool.inputJsonSchema) ? tool.inputJsonSchema : undefined;
    const args = schema && strictSchema(schema);
    if (!schema || !args) {
      encoded.push(tool.name);
      continue;
    }
    const existingIds = current ? groundNodeIds(tool.name, schema, ids, leafIds, unfilled) : schema;
    const grounded = literalOnly && tool.name === "vdt.fill_input_values_batch"
      ? groundLiteralValues(tool.name, existingIds, {
        constructingTree: true, literalUserQuantities: context.literalUserQuantities
      }, context.continuationPolicy.continueWithAssumptions)
      : existingIds;
    typed.set(tool.name, grounded);
    choices.push(object({ toolName: tag(tool.name), args: strictSchema(grounded)! }));
  }
  if (encoded.length) choices.push(object({
    toolName: { type: "string", enum: encoded },
    argsJson: { type: "string", maxLength: 12_000, description: "A single JSON object containing this tool's arguments." }
  }));
  const call = { $ref: "#/$defs/toolCall" };
  const actions = [object({ type: tag("call_tool"), call, statusMessage })];
  if (!context.constraints?.maxOneToolCallPerDecision) actions.push(object({
    type: tag("call_tools"), calls: { type: "array", minItems: 2, maxItems: 6, items: call }, statusMessage
  }));
  const finish = !context.rootConstruction && (!context.hierarchyForFinish
    || (context.hierarchyForFinish.valid && context.validationState?.valid !== false))
    ? [strictSchema(finishSchema)] : [];
  const schema = {
    ...object({ decision: { anyOf: [...actions, strictSchema(questionSchema), ...finish] } }),
    $defs: { toolCall: { anyOf: choices } }
  };
  const instruction = [
    "Return one JSON object with decision. A single call uses decision.call and a batch uses decision.calls. Questions and finish are separate decisions.",
    "Use the argument schema in the response format for native args. An argsJson branch uses the tool's inputJsonSchema from availableTools. Use null for omitted optional fields.",
    "Batch only calls whose arguments are known from the current graph. After a plan or a layer addition, observe the result before targeting any new nodes.",
    "Use the exact value, quote and explicit unit from literalUserQuantities. Fill source inputs before setting formulas that depend on their units.",
    "For a new tree, record the simplest complete factor plan before building layers. Finish requires a complete plan that matches the graph."
  ].join(" ");
  const userPrompt = JSON.stringify({ ...context, availableTools: context.availableTools.flatMap((tool) => {
    if (typed.has(tool.name)) {
      const { inputJsonSchema: _inputJsonSchema, ...summary } = tool;
      return [summary];
    }
    return encoded.includes(tool.name) ? [tool] : [];
  }) });
  function decode(raw: unknown): JsonObject {
    if (!record(raw) || !record(raw.decision)) throw invalid("Expected a decision object.");
    const decision = raw.decision;
    if (decision.type === "call_tool") return {
      type: "call_tool", ...decodeCall(decision.call), statusMessage: decision.statusMessage
    };
    if (decision.type === "call_tools" && Array.isArray(decision.calls)) {
      return { ...decision, calls: decision.calls.map(decodeCall) };
    }
    if (decision.type === "ask_user" && Array.isArray(decision.questions) && decision.questions.length) {
      return omitAbsentFields(decision, questionSchema) as JsonObject;
    }
    if (decision.type === "finish") return decision;
    throw invalid("Expected a tool call, a question, or a final decision.");
  }
  function decodeCall(raw: unknown) {
    if (!record(raw) || typeof raw.toolName !== "string") throw invalid("Tool name is missing.");
    const original = typed.get(raw.toolName);
    if (original && record(raw.args)) return { toolName: raw.toolName, args: omitAbsentFields(raw.args, original) };
    if (!original && encoded.includes(raw.toolName) && typeof raw.argsJson === "string") {
      let args: unknown;
      try { args = JSON.parse(raw.argsJson); } catch { /* Invalid JSON is reported below. */ }
      if (record(args)) return { toolName: raw.toolName, args };
    }
    throw invalid("Tool arguments must match the selected tool's argument object.");
  }
  return { schema, instruction, userPrompt, decode };
}

function strictSchema(value: unknown): JsonObject | undefined {
  if (!record(value)) return undefined;
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/$defs/")) return value;
  const alternatives = value.anyOf ?? value.oneOf;
  if (Array.isArray(alternatives)) {
    const choices = alternatives.map(strictSchema);
    return choices.every(Boolean) ? { anyOf: choices } : undefined;
  }
  if (value.type === "object") {
    if (!record(value.properties) || record(value.additionalProperties) || value.patternProperties) return undefined;
    const required = Array.isArray(value.required) ? value.required : [];
    const properties: JsonObject = {};
    for (const [name, field] of Object.entries(value.properties)) {
      const projected = strictSchema(field);
      if (!projected) return undefined;
      properties[name] = required.includes(name) ? projected : { anyOf: [projected, { type: "null" }] };
    }
    return object(properties);
  }
  if (value.type === "array") {
    const tuple = Array.isArray(value.items) ? value.items : undefined;
    if (tuple && !tuple.every((item) => JSON.stringify(item) === JSON.stringify(tuple[0]))) return undefined;
    const items = strictSchema(tuple ? tuple[0] : value.items);
    if (!items) return undefined;
    const { additionalItems: _additionalItems, ...array } = value;
    return { ...array, items };
  }
  return ["string", "number", "integer", "boolean", "null"].includes(String(value.type)) ? value : undefined;
}

function omitAbsentFields(value: unknown, schema: JsonObject): unknown {
  if (Array.isArray(value)) {
    const item = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    return record(item) ? value.map((entry) => omitAbsentFields(entry, item)) : value;
  }
  if (!record(value)) return value;
  const alternatives = schema.anyOf ?? schema.oneOf;
  const branch = Array.isArray(alternatives) ? alternatives.find((entry) => record(entry) && record(entry.properties)
    && (!record(entry.properties.type) || entry.properties.type.const === undefined || entry.properties.type.const === value.type)) : undefined;
  const properties = schema.properties ?? branch?.properties;
  if (!record(properties)) return value;
  const required = schema.required ?? branch?.required;
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    const field = properties[key];
    if (!record(field)) return [[key, entry]];
    if (entry === null && !(Array.isArray(required) && required.includes(key))
      && field.type !== "null" && !(Array.isArray(field.anyOf) && field.anyOf.some((option) => record(option) && option.type === "null"))) return [];
    return [[key, omitAbsentFields(entry, field)]];
  }));
}

function invalid(message: string): Error {
  return Object.assign(new Error(`AI response failed schema validation: ${message}`), { code: "SCHEMA_INVALID" });
}

/** The Supervisor's wire args are open records. Project the pinned tool catalog
 * to a strict OpenAI response, then restore the canonical turn before parsing. */
export function buildOpenAiModelTurn(
  canonical: ReturnType<typeof import("./provider-json-schema").toProviderJsonSchema>, catalog: unknown,
  observation: JsonObject | undefined, exchangeId: string, finishReceiptId: string | undefined,
  options: {
    continueWithoutQuestion?: boolean;
    requireOpeningMessage?: boolean;
    planRecorded?: boolean;
    allowPlanRevision?: boolean;
    constructionPlan?: OpenAiConstructionPlan;
    hierarchyRepair?: HierarchyRepairCall[];
    reviewInitialPlan?: boolean;
    initialPlanRepair?: VdtDecompositionPlan;
    verifiedFinalText?: string;
  } = {}
) {
  if (!Array.isArray(catalog)) return undefined;
  const root = structuredClone(canonical) as JsonObject;
  const properties = root.properties as JsonObject;
  properties.turnId = tag(exchangeId);
  const openingMessage = properties.assistantMessage;
  if (observation?.constructingTree === true) {
    properties.assistantMessage = { type: "null" };
  } else if (options.requireOpeningMessage && record(openingMessage) && Array.isArray(openingMessage.anyOf)) {
    openingMessage.anyOf = openingMessage.anyOf.filter((item) => !record(item) || item.type !== "null");
  }
  const action = properties.action as { anyOf: JsonObject[] };
  const batch = action.anyOf.find((item) => (item.properties as { type: { const: string } }).type.const === "action_batch")!;
  const batchProperties = ((batch.properties as JsonObject).batch as { properties: JsonObject }).properties;
  const calls = batchProperties.calls as JsonObject;
  const buildingFirstLayer = observation?.constructingTree === true && observation.needsStructure === true
    && observation.nodeCount === 1;
  const resolution = record(observation?.skillResolution) && !observation.skillResolution.outcome ? observation.skillResolution : undefined;
  const reads = resolution && Array.isArray(resolution.reads) ? resolution.reads.filter(record) : [];
  const scopeExcludedIds = Array.isArray(resolution?.scopeExcludedSkillIds) ? resolution.scopeExcludedSkillIds : [];
  const selectableReads = reads.filter(({ skillId }) => !scopeExcludedIds.includes(skillId));
  const pinnedId = typeof resolution?.pinnedSkillId === "string" ? resolution.pinnedSkillId : undefined;
  const unreadIds = pinnedId ? [pinnedId] : Array.isArray(resolution?.candidateIds)
    ? resolution.candidateIds.filter((id): id is string => typeof id === "string" && !reads.some((receipt) => receipt.skillId === id))
    : [];
  const repair = !finishReceiptId && options.hierarchyRepair?.length && options.hierarchyRepair.every(({ toolName }) =>
    catalog.some((tool) => record(tool) && tool.name === toolName)) ? options.hierarchyRepair : undefined;
  const plan = options.constructionPlan;
  const executablePlanLayer = plan?.pendingFactors && plan.additions.length > 0 && !plan.kindConflicts?.length
    && !repair && !options.allowPlanRevision && !(Array.isArray(observation?.unboundSourceFacts) && observation.unboundSourceFacts.length);
  const typed = new Map<string, JsonObject>();
  const encoded: string[] = [];
  const choices: JsonObject[] = [];
  for (const tool of catalog) {
    if (!record(tool) || typeof tool.name !== "string") continue;
    const name = tool.name;
    if (name === "user.ask" || (!resolution && name === "skill.report_gap")) continue;
    if (observation?.constructingTree === true && record(observation.skillResolution) && observation.skillResolution.outcome
      && observation.skillResolution.selectedSkillId !== "mining.excavation" && name.startsWith("excavation.")) continue;
    if (resolution) {
      const available = pinnedId ? name === "skill.read"
        : !resolution.catalogBrowsed ? name === "skill.list"
        : (name === "skill.report_gap" && !scopeExcludedIds.length && (resolution.catalogComplete || resolution.scopedSearchReviewed))
          || (name === "skill.list" && typeof resolution.nextOffset === "number")
          || name === "skill.search"
          || (name === "skill.read" && unreadIds.length > 0) || (name === "skill.select" && selectableReads.length > 0);
      if (!available) continue;
    }
    if (options.reviewInitialPlan && buildingFirstLayer && name !== "vdt.set_decomposition_plan") continue;
    if (repair && ["vdt.inspect_hierarchy", "vdt.validate", "vdt.calculate"].includes(name)) continue;
    if (buildingFirstLayer && !["vdt.set_decomposition_plan", "vdt.add_driver", "vdt.add_drivers_batch", "tools.describe"].includes(name)
      && !name.startsWith("skill.") && !name.startsWith("data.") && !name.startsWith("research.")) continue;
    if (finishReceiptId || (observation?.nodeCount === 0 && tool.requiresDraftProject)
      || (name === "vdt.create_draft" && typeof observation?.nodeCount === "number" && observation.nodeCount > 0)
      || (name === "run.request_finish" && observation?.projectReadyForFinish !== true)
      || (name === "vdt.fill_input_values_batch" && (observation?.unfilledInputCount === 0
        || (observation?.constructingTree === true && Array.isArray(observation.sourceBindings) && observation.sourceBindings.length > 0
          && Array.isArray(observation.literalUserQuantities) && observation.literalUserQuantities.length === 0
          && observation.allowAssumptions !== true)))) continue;
    if (observation?.constructingTree === true && observation?.hierarchyRequired === true
      && observation?.hasDecompositionPlan === false && tool.mutatesProject
      && name !== "vdt.create_draft" && name !== "vdt.set_decomposition_plan") continue;
    if (observation?.needsStructure === true && ["vdt.set_formula", "vdt.update_node", "vdt.validate", "vdt.calculate"].includes(name)) continue;
    if (executablePlanLayer && name === "vdt.set_decomposition_plan") continue;
    if (buildingFirstLayer && options.planRecorded && plan?.additions.length && name === "vdt.set_decomposition_plan") continue;
    if (name === "vdt.set_formula" && plan && !plan.calculatedIds.length) continue;
    const constructionLink = name === "vdt.add_edge" && observation?.constructingTree === true && plan;
    if (constructionLink && !constructionLink.orphanLinks?.length) continue;
    if ((!nativeTools.has(name) && !constructionLink) || !record(tool.inputJsonSchema)) { encoded.push(name); continue; }
    const ids = name === "vdt.set_formula" && plan
      ? groundNodeIds(name, tool.inputJsonSchema, plan.calculatedIds, [], [])
      : groundExistingIds(name, tool.inputJsonSchema, observation);
    const args = constructionLink ? orphanLinkArguments(tool.inputJsonSchema, constructionLink.orphanLinks ?? [])
      : plan && ["vdt.add_driver", "vdt.add_drivers_batch"].includes(name)
      ? plannedDriverArguments(name, tool.inputJsonSchema, plan, observation)
      : groundLiteralValues(name, boundConstructionArguments(name, ids, observation), observation, observation?.allowAssumptions === true);
    if (!args) continue;
    let projected = name === "vdt.set_decomposition_plan" && observation?.constructingTree === true
      ? constructionPlanArguments(args, observation.rootNodeId, buildingFirstLayer)
      : name === "vdt.update_node" && observation?.constructingTree === true ? constructionUpdateArguments(args, plan?.nodeUpdateTypes) : args;
    if (resolution && record(projected.properties)) {
      const properties = { ...projected.properties };
      projected = { ...projected, properties };
      if (name === "skill.read") {
        properties.skillId = { ...properties.skillId as JsonObject, enum: unreadIds };
      } else if (name === "skill.list" && typeof resolution.nextOffset === "number") {
        properties.offset = { type: "integer", const: resolution.nextOffset };
        projected.required = ["offset"];
      } else if (name === "skill.select") {
        properties.skillId = { ...properties.skillId as JsonObject, enum: [...new Set(selectableReads.map((receipt) => receipt.skillId))] };
        properties.readReceiptId = { ...properties.readReceiptId as JsonObject, enum: selectableReads.map((receipt) => receipt.readReceiptId) };
        projected.required = ["skillId", "reason", "readReceiptId"];
      }
    }
    const strict = strictSchema(projected);
    if (!strict) { encoded.push(name); continue; }
    typed.set(name, projected);
    const exactRead = name === "skill.select" && selectableReads.length && record(strict.properties)
      ? { anyOf: selectableReads.map(({ skillId, readReceiptId }) => ({
          ...strict, properties: { ...strict.properties as JsonObject, skillId: { type: "string", const: skillId },
            readReceiptId: { type: "string", const: readReceiptId } }
        })) }
      : strict;
    choices.push(object({ toolName: tag(name), args: exactRead }));
  }
  if (encoded.length) choices.push(object({ toolName: { type: "string", enum: encoded },
    argsJson: { type: "string", maxLength: 12_000 } }));
  batchProperties.calls = { ...calls, ...(resolution || observation?.nodeCount === 0 || buildingFirstLayer || plan?.pendingFactors || options.continueWithoutQuestion ? { maxItems: 1 } : {}),
    items: { $ref: "#/$defs/toolCall" } };
  action.anyOf = action.anyOf.filter((item) => {
    const kind = (item.properties as { type: { const: string } }).type.const;
    // The initial turn can clarify direction. Once the accepted draft contains
    // only its root, choose a construction action before asking for leaf data.
    if (!finishReceiptId) return kind !== "final"
      && !(kind === "question" && (buildingFirstLayer || options.continueWithoutQuestion));
    if (kind !== "final") return false;
    const finalProperties = item.properties as JsonObject;
    finalProperties.finishReceiptId = tag(finishReceiptId);
    if (options.verifiedFinalText !== undefined) finalProperties.text = { type: "null" };
    return true;
  });
  const initialPlanRepair = !finishReceiptId && buildingFirstLayer && observation?.hasDecompositionPlan === false
    && typed.has("vdt.set_decomposition_plan") ? options.initialPlanRepair : undefined;
  if (repair) action.anyOf.push(object({ type: tag("apply_hierarchy_repair") }));
  if (initialPlanRepair) action.anyOf.push(object({ type: tag("apply_plan_repair") }));
  const schema = strictSchema(root);
  if (!schema) return undefined;
  if (choices.length) schema.$defs = { toolCall: { anyOf: choices } };
  const actions = new Set(action.anyOf.map((item) => (item.properties as { type: { const: string } }).type.const));
  function decode(raw: unknown): unknown {
    const restored = omitAbsentFields(raw, root);
    if (!record(restored) || !record(restored.action) || typeof restored.action.type !== "string"
      || !actions.has(restored.action.type)) throw invalid("Action does not match the current construction or finish stage.");
    if (restored.action.type === "final" && options.verifiedFinalText !== undefined) {
      return { ...restored, action: { ...restored.action, text: options.verifiedFinalText } };
    }
    if (restored.action.type === "apply_hierarchy_repair" && repair) {
      return { ...restored, action: { type: "action_batch", batch: {
        calls: repair.map((call, index) => ({ ...call, externalCallId: `${exchangeId}:call:${index + 1}` }))
      } } };
    }
    if (restored.action.type === "apply_plan_repair" && initialPlanRepair) {
      return { ...restored, action: { type: "action_batch", batch: { calls: [{
        toolName: "vdt.set_decomposition_plan", args: { plan: initialPlanRepair }, externalCallId: `${exchangeId}:call:1`
      }] } } };
    }
    if (restored.action.type !== "action_batch"
      || !record(restored.action.batch) || !Array.isArray(restored.action.batch.calls)) return restored;
    restored.action.batch.calls = restored.action.batch.calls.map((call, index) => {
      if (!record(call) || typeof call.toolName !== "string") return call;
      const externalCallId = `${exchangeId}:call:${index + 1}`;
      const args = typed.get(call.toolName);
      if (args && record(call.args)) {
        const canonicalArgs = omitAbsentFields(call.args, args);
        if (call.toolName === "vdt.set_decomposition_plan" && observation?.constructingTree === true) {
          resolveImplicitRoot(canonicalArgs, observation.rootNodeId);
        }
        if (call.toolName === "vdt.set_formula" && observation?.constructingTree === true && record(canonicalArgs)
          && typeof canonicalArgs.formula === "string") {
          const assignment = /^\s*([a-z_][a-z_0-9]*)?\s*=\s*/i.exec(canonicalArgs.formula);
          if (assignment && (!assignment[1] || assignment[1] === canonicalArgs.nodeId)) {
            canonicalArgs.formula = canonicalArgs.formula.slice(assignment[0].length);
          }
        }
        return { ...call, externalCallId, args: canonicalArgs };
      }
      if (encoded.includes(call.toolName) && typeof call.argsJson === "string") {
        let value: unknown;
        try { value = JSON.parse(call.argsJson); } catch { throw invalid("Encoded arguments must contain a JSON object."); }
        if (!record(value)) throw invalid("Encoded arguments must contain a JSON object.");
        const { argsJson: _argsJson, ...rest } = call;
        return { ...rest, externalCallId, args: value };
      }
      throw invalid("Tool arguments must match the selected tool's argument schema.");
    });
    return restored;
  }
  const toolGuidance = catalog.flatMap((tool) => {
    if (!record(tool) || typeof tool.name !== "string") return [];
    if (typed.has(tool.name)) return [{ name: tool.name, description: tool.description }];
    return encoded.includes(tool.name) ? [{ name: tool.name, description: tool.description, inputJsonSchema: tool.inputJsonSchema }] : [];
  });
  return { schema, decode, toolGuidance, hasHierarchyRepair: !!repair, hasInitialPlanRepair: !!initialPlanRepair };
}

function constructionPlanArguments(schema: JsonObject, rootId: unknown, firstLayer: boolean): JsonObject {
  if (typeof rootId !== "string") return schema;
  const copy = structuredClone(schema);
  const plan = record(copy.properties) && copy.properties.plan;
  const nodes = record(plan) && record(plan.properties) && plan.properties.nodes;
  const fields = record(nodes) && record(nodes.items) && nodes.items.properties;
  if (!record(fields) || !record(fields.nodeId) || !record(fields.parentNodeId)) return schema;
  fields.nodeId = { ...fields.nodeId, ...(firstLayer ? { pattern: newDriverId, maxLength: 80 } : {}),
    description: "The ID of an existing or new descendant. The root is implicit." };
  fields.parentNodeId = { anyOf: [{ type: "null", description: "A direct child of the existing root." }, {
    ...fields.parentNodeId, description: `Use ${rootId} or the exact ID of a planned calculated parent. Context entries may use a context parent.`
  }] };
  if (record(fields.rationale)) fields.rationale = {
    ...fields.rationale, description: "Required for context entries. Omit for ordinary formula operands."
  };
  if (record(fields.sharedWith)) fields.sharedWith = {
    ...fields.sharedWith, description: "Only additional calculations that actually use this factor. Omit when its own parent is its only formula user."
  };
  return copy;
}

function resolveImplicitRoot(args: unknown, rootId: unknown): void {
  if (typeof rootId !== "string" || !record(args) || !record(args.plan) || !Array.isArray(args.plan.nodes)) return;
  const nodes = args.plan.nodes.filter(record);
  const ids = new Set(nodes.map((node) => node.nodeId));
  for (const node of nodes) {
    const parent = node.parentNodeId;
    if (parent === null || (typeof parent === "string" && /^root(?:_kpi)?$/i.test(parent) && !ids.has(parent))) node.parentNodeId = rootId;
  }
}

type NodeUpdateTypes = { nodeIds: string[]; types?: readonly VdtNodeType[] };

function constructionUpdateArguments(schema: JsonObject, groups?: NodeUpdateTypes[]): JsonObject {
  const copy = structuredClone(schema);
  const patch = record(copy.properties) && copy.properties.patch;
  if (!record(patch) || !record(patch.properties)) return copy;
  if ("formula" in patch.properties) {
    delete patch.properties.formula;
    if (Array.isArray(patch.required)) patch.required = patch.required.filter((field) => field !== "formula");
  }
  if (!groups?.length) return copy;
  const variants = groups.map(({ nodeIds, types }) => {
    const option = structuredClone(copy);
    const fields = option.properties as JsonObject;
    fields.nodeId = { type: "string", enum: nodeIds };
    if (types) {
      const patch = fields.patch as JsonObject;
      (patch.properties as JsonObject).type = types.length === 1 ? tag(types[0]!) : { type: "string", enum: types };
    }
    return option;
  });
  return variants.length === 1 ? variants[0]! : { anyOf: variants };
}

type OpenAiConstructionPlan = {
  additions: Array<{ parentNodeId: string; nodeIds: string[] }>;
  calculatedIds: string[];
  pendingFactors: boolean;
  plannedKinds?: Record<string, VdtDecompositionPlan["nodes"][number]["kind"]>;
  settledFormulaIds?: string[];
  kindConflicts?: ReturnType<typeof plannedFactorTypeConflicts>;
  nodeUpdateTypes?: NodeUpdateTypes[];
  orphanLinks?: Array<Pick<VdtDecompositionPlan["nodes"][number], "nodeId" | "parentNodeId" | "kind">>;
};

export function initialPlanIssues(proposal: unknown, rootNodeId: string): string[] {
  const shape = decompositionPlanErrors(proposal, rootNodeId);
  if (shape.length) return shape;
  const plan = proposal as VdtDecompositionPlan;
  return [
    ...decompositionPlanGroupingErrors(plan, rootNodeId),
    ...calculationsWithoutPlannedInputs(plan).map((id) => `CALCULATION_NEEDS_FACTORS: ${id}`),
    ...(!plan.nodes.some(({ parentNodeId, kind, sharedWith }) => kind !== "context"
      && (parentNodeId === rootNodeId || sharedWith?.includes(rootNodeId)))
      ? ["ROOT_NEEDS_FACTORS: the existing root needs at least one direct or shared formula operand."] : [])
  ];
}

/** Offer a corrected initial proposal only when the same factors and their
 * links survive removal of a redundant root entry or operandless leaves. */
export function checkedInitialPlanRepair(
  proposal: unknown, rootNodeId: string, facts: readonly LiteralUserQuantity[] = []
): VdtDecompositionPlan | undefined {
  if (!record(proposal) || !Array.isArray(proposal.nodes) || !proposal.nodes.every(record)) return;
  const duplicateRoot = proposal.nodes.filter(({ nodeId }) => nodeId === rootNodeId);
  const root = duplicateRoot[0];
  const withoutRoot = duplicateRoot.length === 1 && root?.kind === "calculated" && root.parentNodeId === rootNodeId
    && root.rationale === undefined && (root.sharedWith === undefined || (Array.isArray(root.sharedWith) && !root.sharedWith.length))
    ? { ...proposal, nodes: proposal.nodes.filter((entry) => entry !== root) } : proposal;
  if (decompositionPlanErrors(withoutRoot, rootNodeId).length) return;
  const plan = withoutRoot as unknown as VdtDecompositionPlan;
  const operandless = new Set(calculationsWithoutPlannedInputs(plan));
  const parentsAndSharedUsers = new Set(plan.nodes.flatMap(({ parentNodeId, sharedWith }) => [parentNodeId, ...(sharedWith ?? [])]));
  const nodes = plan.nodes.filter(({ nodeId, sharedWith }) =>
    !operandless.has(nodeId) || parentsAndSharedUsers.has(nodeId) || sharedWith?.length);
  const typedFacts = new Set(facts.filter(({ unit }) => unit).map(({ value, quote }) => JSON.stringify([value, quote])));
  const inputCount = nodes.filter(({ kind }) => kind === "input").length;
  if (nodes.length === proposal.nodes.length || inputCount < Math.max(1, typedFacts.size)) return;
  const repaired = { ...plan, nodes };
  if (initialPlanIssues(repaired, rootNodeId).length) return;
  return repaired;
}

/** Project the full current graph into the same addition frontier enforced by
 * the Gateway and the calculated nodes whose declared references exist. */
export function openAiConstructionPlan(project: VdtProject): OpenAiConstructionPlan | undefined {
  const { rootNodeId, graph } = project;
  const plan = graph.nodes.find(({ id }) => id === rootNodeId)?.decompositionPlan;
  if (!plan) return undefined;
  if (decompositionPlanErrors(plan, rootNodeId).length) return { additions: [], calculatedIds: [], pendingFactors: true };
  const byParent = new Map<string, string[]>();
  const plannedKinds: NonNullable<OpenAiConstructionPlan["plannedKinds"]> = {};
  const driverIdPattern = new RegExp(newDriverId);
  for (const { parentNodeId, nodeId, kind } of plannedAdditionCandidates(project)) {
    if (!driverIdPattern.test(nodeId)) continue;
    const siblings = byParent.get(parentNodeId) ?? [];
    siblings.push(nodeId);
    byParent.set(parentNodeId, siblings);
    plannedKinds[nodeId] = kind;
  }
  const existing = new Set(graph.nodes.map(({ id }) => id));
  const factors = plan.nodes.filter(({ kind }) => kind !== "context");
  const kindConflicts = plannedFactorTypeConflicts(graph, plan);
  const kindById = new Map(plan.nodes.map(({ nodeId, kind }) => [nodeId, kind]));
  const updateGroups = new Map<string, NodeUpdateTypes>();
  for (const node of graph.nodes) {
    const types = constructionNodeUpdateTypes(node, rootNodeId, kindById.get(node.id));
    const key = types?.join(",") ?? "";
    const group = updateGroups.get(key) ?? { nodeIds: [], ...(types ? { types } : {}) };
    group.nodeIds.push(node.id);
    updateGroups.set(key, group);
  }
  const additions = [...byParent].map(([parentNodeId, nodeIds]) => ({ parentNodeId, nodeIds }));
  const orphanLinks = plannedOrphanLinks(project).slice(0, 12).map(({ nodeId, parentNodeId, kind }) => ({ nodeId, parentNodeId, kind }));
  const calculatedIds = plannedFormulaTargets(project);
  const pendingFactors = factors.some(({ nodeId }) => !existing.has(nodeId));
  const unfinished = pendingFactors && additions.length ? new Set(plannedFormulaTargets(project, true)) : undefined;
  const settledFormulaIds = unfinished ? calculatedIds.filter((id) => !unfinished.has(id)) : [];
  return { calculatedIds, additions, pendingFactors, nodeUpdateTypes: [...updateGroups.values()],
    ...(additions.length ? { plannedKinds } : {}), ...(orphanLinks.length ? { orphanLinks } : {}),
    ...(kindConflicts.length ? { kindConflicts } : {}), ...(settledFormulaIds.length ? { settledFormulaIds } : {}) };
}

function orphanLinkArguments(schema: JsonObject, links: NonNullable<OpenAiConstructionPlan["orphanLinks"]>): JsonObject | undefined {
  const variants = links.flatMap(({ nodeId, parentNodeId, kind }) => {
    const option = structuredClone(schema);
    if (!record(option.properties) || !record(option.properties.relation)) return [];
    const relation = option.properties.relation;
    if (!Array.isArray(relation.enum)) return [];
    const allowedRelations = relation.enum.filter((value) => (value === "contextual_influence") === (kind === "context"));
    option.properties.sourceNodeId = tag(parentNodeId);
    option.properties.targetNodeId = tag(nodeId);
    relation.enum = allowedRelations;
    return allowedRelations.length ? [option] : [];
  });
  return variants.length ? { anyOf: variants } : undefined;
}

function plannedDriverArguments(
  name: string, schema: JsonObject, plan: OpenAiConstructionPlan, observation: JsonObject | undefined
): JsonObject | undefined {
  const batch = name === "vdt.add_drivers_batch";
  const variants = plan.additions.flatMap(({ parentNodeId: parent, nodeIds: ids }) => {
    if (batch && ids.length < 2) return [];
    const option = boundConstructionArguments(name, groundNodeIds(name, schema, [parent], [], []), observation);
    if (!record(option.properties)) return [];
    const drivers = option.properties.drivers;
    const driver = batch && record(drivers) ? drivers.items : option;
    if (!record(driver) || !record(driver.properties)) return [];
    const byKind = new Map<VdtDecompositionPlan["nodes"][number]["kind"] | undefined, string[]>();
    for (const id of ids) {
      const kind = plan.plannedKinds?.[id];
      const group = byKind.get(kind) ?? [];
      group.push(id);
      byKind.set(kind, group);
    }
    const typedDrivers = [...byKind].map(([kind, nodeIds]) => {
      const args = structuredClone(driver);
      const fields = args.properties as JsonObject;
      fields.parentNodeId = tag(parent);
      fields.nodeId = { type: "string", enum: nodeIds };
      const types = kind && plannedFactorNodeTypes(kind);
      if (types) {
        fields.type = types.length === 1 ? tag(types[0]!) : { type: "string", enum: types };
        args.required = [...new Set([...(Array.isArray(args.required) ? args.required : []), "type"])];
      }
      return args;
    });
    if (!batch || !record(drivers)) return typedDrivers;
    drivers.items = typedDrivers.length > 1 ? { anyOf: typedDrivers } : typedDrivers[0];
    if (typeof drivers.maxItems === "number") drivers.maxItems = Math.min(ids.length, drivers.maxItems);
    return [option];
  });
  return variants.length > 1 ? { anyOf: variants } : variants[0];
}
