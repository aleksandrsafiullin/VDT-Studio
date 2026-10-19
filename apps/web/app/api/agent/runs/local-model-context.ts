import { calculateGraph, extractFormulaReferences, validateGraph, inspectDecompositionHierarchy,getDecompositionContextGroupIds,type VdtProject } from "@vdt-studio/vdt-core";
import { LOCAL_MODEL_UPFRONT_TOOLS } from "./local-model-output-schema";

/** A transport-only table view of project inspection results. Receipts and
 * Gateway hashes retain the original payload; every node/edge field remains
 * available to the model without repeating its JSON keys for every row. */
export function compactLocalModelPrompt(prompt: string): string {
  let input: unknown;
  try { input = JSON.parse(prompt); } catch { return prompt; }
  if (!isRecord(input) || !isRecord(input.delta)) return prompt;
  return JSON.stringify({ ...input, delta: compactDelta(input.delta) });
}

function compactDelta(delta: Record<string, unknown>): Record<string, unknown> {
  if (delta.type === "initial_context" && isRecord(delta.context) && Array.isArray(delta.context.tools)
    && delta.context.tools.some((tool) => isRecord(tool) && tool.name === "tools.describe")) {
    const continuing = isRecord(delta.context.brief) && delta.context.brief.mode !== "generate_vdt";
    return { ...delta, context: { ...delta.context, tools: delta.context.tools.map((tool) => {
      if (!isRecord(tool)) return tool;
      const card = { name: tool.name, description: tool.description };
      return { ...card, ...(LOCAL_MODEL_UPFRONT_TOOLS.has(String(tool.name))
        ? { inputSchemaEnforcedBy: "native format" }
        : { inputSchemaAvailableVia: "tools.describe" }),
        ...(tool.name === "vdt.create_draft" && continuing
          ? { available: false, reason: "The current draft already exists; edit its existing root and drivers." } : {})
      };
    }) } };
  }
  if (delta.type === "checkpoint_inputs" && isRecord(delta.checkpointDelta)) {
    return { ...delta, checkpointDelta: compactDelta(delta.checkpointDelta) };
  }
  if ((delta.type !== "tool_results" && delta.type !== "manual_reconciliation") || !Array.isArray(delta.results)) return delta;
  return { ...delta, results: delta.results.map((result) => {
    if (!isRecord(result) || !["project.get_current", "project.read_current", "project.get_subtree"].includes(String(result.toolName))
      || !isRecord(result.payload) || !isRecord(result.payload.output)) return result;
    const output = result.payload.output;
    const key = result.toolName === "project.get_subtree" ? "subtree" : "project";
    const project = output[key];
    if (!isRecord(project) || !Array.isArray(project.nodes) || !Array.isArray(project.edges)) return result;
    if (!project.nodes.every(isRecord) || !project.edges.every(isRecord)) return result;
    const nodes = table(project.nodes);
    const edges = table(project.edges);
    return {
      ...result,
      modelPayloadProjection: "project-tables-v1",
      payload: { ...result.payload, output: { ...output, [key]: {
        ...project, nodeColumns: nodes.columns, nodes: nodes.rows,
        edgeColumns: edges.columns, edges: edges.rows
      } } }
    };
  }) };
}

function table(rows: Record<string, unknown>[]) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return { columns, rows: rows.map((row) => columns.map((key) => row[key] ?? null)) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Server-read working state, never an instruction or a mutation. Sending a
 * fresh bounded view avoids relying on a small model to remember generated IDs
 * in its semantic checkpoint. The Gateway still fences every actual write. */
export function localModelWorkingContext(project: VdtProject, revision: number, requireDerivedRoot = false, requireHierarchy = false) {
  const calculation = calculateGraph(project.graph, { rootNodeId: project.rootNodeId });
  const validation = validateGraph(project);
  const root = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  const hierarchy=inspectDecompositionHierarchy(project);
  const contextGroups=getDecompositionContextGroupIds(project.graph,project.rootNodeId);
  let derivedRoot = false;
  try { derivedRoot = !!root?.formula?.trim() && extractFormulaReferences(root.formula).length > 0; } catch { /* Validation below reports the parser error. */ }
  const missing = project.graph.nodes.filter((node) => node.id !== project.rootNodeId && !contextGroups.has(node.id)
    && !["root_kpi", "calculated"].includes(node.type) && !node.formula?.trim()
    && !Number.isFinite(node.baselineValue ?? node.value));
  const formulaBacklog = project.graph.nodes.filter((node) => !contextGroups.has(node.id) && ["root_kpi", "calculated"].includes(node.type)
    && !node.formula?.trim() && (node.id !== project.rootNodeId || project.graph.nodes.length > 1));
  const assumptions = project.graph.nodes.filter((node) => ["root_kpi", "calculated"].includes(node.type) && node.assumptions?.length);
  const columns = ["id", "name", "type", "unit", "formula", "baselineValue", "value", "valueStatus"] as const;
  const limit = 80;
  const parents = new Set(project.graph.edges.map((edge) => edge.sourceNodeId));
  const inputLeafIds = project.graph.nodes.filter((node) => node.id !== project.rootNodeId
    && !["root_kpi", "calculated"].includes(node.type) && !node.formula?.trim() && !parents.has(node.id)).map((node) => node.id);
  const unfilledInputLeafIds = missing.filter((node) => !parents.has(node.id)).map((node) => node.id);
  const projectReadyForFinish = validation.valid && calculation.errors.length === 0 && Number.isFinite(calculation.rootValue)
    && (!requireDerivedRoot || (project.graph.nodes.length > 1 && derivedRoot)) && (!requireHierarchy || hierarchy.valid);
  const dependencies = new Set<string>();
  if (projectReadyForFinish) {
    const byId = new Map(project.graph.nodes.map((node) => [node.id, node]));
    const queue = [project.rootNodeId];
    while (queue.length) {
      const id = queue.pop()!;
      if (dependencies.has(id)) continue;
      dependencies.add(id);
      const formula = byId.get(id)?.formula;
      if (formula?.trim()) queue.push(...extractFormulaReferences(formula));
    }
  }
  return {
    schemaVersion: "local-model-working-context.v1",
    revision,
    rootNodeId: project.rootNodeId,
    hierarchyRequired:requireHierarchy,
    hasDecompositionPlan:!!root?.decompositionPlan,
    referenceGroupIds:[...contextGroups],
    decompositionPlan:root?.decompositionPlan,
    hierarchy:{valid:hierarchy.valid,errors:hierarchy.errors.slice(0,12),errorCount:hierarchy.errors.length,maxDepth:hierarchy.maxDepth},
    nodeCount: project.graph.nodes.length,
    constructingTree: requireDerivedRoot,
    needsStructure: requireDerivedRoot && project.graph.nodes.length <= 1,
    projectReadyForFinish,
    rootHasDriverReferences: derivedRoot,
    writableInputCount: inputLeafIds.length,
    inputLeafIds: inputLeafIds.slice(0, limit),
    unfilledInputCount: unfilledInputLeafIds.length,
    unfilledInputLeafIds: unfilledInputLeafIds.slice(0, limit),
    ...(requireDerivedRoot && project.graph.nodes.length <= limit && unfilledInputLeafIds.length ? {
      nativeInputBatch: { schemaVersion: "values_by_node_id.v1", batches: Array.from({ length: Math.ceil(unfilledInputLeafIds.length / 8) }, (_, index) => unfilledInputLeafIds.slice(index * 8, (index + 1) * 8)) }
    } : {}),
    unresolvedInputs: {
      count: missing.length,
      nodes: missing.slice(0, 12).map(({ id, name, unit }) => ({ id, name, unit })),
      truncated: missing.length > 12,
      suggestedNextTools: ["vdt.fill_input_values_batch", "vdt.update_node"]
    },
    formulaBacklog: {
      count: formulaBacklog.length,
      nodes: formulaBacklog.slice(0, 8).map(({ id, name }) => ({ id, name })),
      truncated: formulaBacklog.length > 8,
      suggestedNextTools: ["vdt.set_formula", "vdt.add_drivers_batch"]
    },
    calculationAssumptions: {
      nodes: assumptions.slice(0, 8).map((node) => ({ id: node.id, assumptions: node.assumptions!.slice(0, 2).map((note) => note.slice(0, 160)),
        truncated: node.assumptions!.length > 2 || node.assumptions!.some((note) => note.length > 160) })),
      truncated: assumptions.length > 8
    },
    nodeColumns: columns,
    nodes: project.graph.nodes.slice(0, limit).map((node) => columns.map((key) => node[key] ?? null)),
    truncated: project.graph.nodes.length > limit,
    ...(projectReadyForFinish ? {
      rootDependencyInputs: project.graph.nodes.filter((node) => dependencies.has(node.id) && inputLeafIds.includes(node.id)).slice(0, limit)
        .map((node) => ({ id: node.id, name: node.name, unit: node.unit, value: node.baselineValue ?? node.value, valueStatus: node.valueStatus, sourceNote: node.valueSource?.note })),
      unusedInputIds: inputLeafIds.filter((id) => !dependencies.has(id)).slice(0, limit)
    } : {}),
    calculation: {
      rootValue: calculation.rootValue ?? null,
      valueCount: Object.keys(calculation.values).length,
      errors: calculation.errors.slice(0, 8),
      errorCount: calculation.errors.length
    },
    validation: { valid: validation.valid, errors: validation.errors.slice(0, 8), errorCount: validation.errors.length }
  };
}
