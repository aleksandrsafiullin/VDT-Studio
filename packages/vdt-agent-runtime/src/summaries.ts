import type {
  CalculationTraceItem,
  GraphCalculationResult,
  ValidationResult,
  VdtProject,
  VdtWarning
} from "@vdt-studio/vdt-core";
import type {
  AgentEventSummary,
  CalculationStateSummary,
  FormulaBacklogItem,
  ManualChangeSummary,
  NodeSummary,
  ProjectSummary,
  ValidationIssueSummary,
  ValidationStateSummary,
  VdtAgentEvent,
  VdtAgentRunState
} from "./types";

export const MAX_CONTEXT_NODES = 60;
export const MAX_DECISION_CONTEXT_NODES = 24;
export const MAX_RECENT_EVENTS = 12;
export const MAX_MANUAL_CHANGES = 20;

export function summarizeProject(project: VdtProject, maxNodes = MAX_CONTEXT_NODES): ProjectSummary {
  const childIdsByNode = new Map<string, string[]>();
  for (const edge of project.graph.edges) {
    childIdsByNode.set(edge.sourceNodeId, [...(childIdsByNode.get(edge.sourceNodeId) ?? []), edge.targetNodeId]);
  }
  const includedNodeIds = new Set(project.graph.nodes.slice(0, maxNodes).map((node) => node.id));
  return {
    id: project.id,
    name: project.name,
    rootNodeId: project.rootNodeId,
    nodeCount: project.graph.nodes.length,
    edgeCount: project.graph.edges.length,
    nodes: project.graph.nodes.slice(0, maxNodes).map((node): NodeSummary => ({
      id: node.id,
      name: node.name,
      type: node.type,
      unit: node.unit,
      formula: node.formula,
      baselineValue: node.baselineValue,
      value: node.value,
      status: node.status,
      childIds: childIdsByNode.get(node.id) ?? []
    })),
    edges: project.graph.edges
      .filter((edge) => includedNodeIds.has(edge.sourceNodeId) && includedNodeIds.has(edge.targetNodeId))
      .map((edge) => ({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        relation: edge.relation
      })),
    truncated: project.graph.nodes.length > maxNodes
  };
}

export function summarizeProjectForDecision(
  project: VdtProject,
  priorityNodeIds: readonly string[] = [],
  maxNodes = MAX_DECISION_CONTEXT_NODES
): ProjectSummary {
  const parentByNodeId = new Map<string, string>();
  for (const edge of project.graph.edges) {
    if (!parentByNodeId.has(edge.targetNodeId)) parentByNodeId.set(edge.targetNodeId, edge.sourceNodeId);
  }
  const knownNodeIds = new Set(project.graph.nodes.map((node) => node.id));
  const selected: string[] = [];
  const selectedSet = new Set<string>();
  const add = (nodeId: string): void => {
    if (selected.length >= maxNodes || selectedSet.has(nodeId) || !knownNodeIds.has(nodeId)) return;
    selectedSet.add(nodeId);
    selected.push(nodeId);
  };
  const addWithPath = (nodeId: string): void => {
    const path: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = nodeId;
    while (current && !seen.has(current)) {
      seen.add(current);
      path.unshift(current);
      current = parentByNodeId.get(current);
    }
    path.forEach(add);
  };

  add(project.rootNodeId);
  for (const nodeId of priorityNodeIds) addWithPath(nodeId);
  for (const item of buildFormulaBacklog(project)) addWithPath(item.nodeId);
  for (const node of project.graph.nodes) add(node.id);

  const nodeById = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const prioritizedProject: VdtProject = {
    ...project,
    graph: {
      ...project.graph,
      nodes: selected.map((nodeId) => nodeById.get(nodeId)!).filter(Boolean),
      edges: project.graph.edges.filter((edge) => selectedSet.has(edge.sourceNodeId) && selectedSet.has(edge.targetNodeId))
    }
  };
  const summary = summarizeProject(prioritizedProject, maxNodes);
  return {
    ...summary,
    nodeCount: project.graph.nodes.length,
    edgeCount: project.graph.edges.length,
    truncated: project.graph.nodes.length > selected.length
  };
}

export function buildFormulaBacklog(project: VdtProject): FormulaBacklogItem[] {
  const childIdsByNode = new Map<string, string[]>();
  const parentByNodeId = new Map<string, string>();
  for (const edge of project.graph.edges) {
    childIdsByNode.set(edge.sourceNodeId, [...(childIdsByNode.get(edge.sourceNodeId) ?? []), edge.targetNodeId]);
    if (!parentByNodeId.has(edge.targetNodeId)) parentByNodeId.set(edge.targetNodeId, edge.sourceNodeId);
  }
  const depthFor = (nodeId: string): number => {
    let depth = 0;
    let current = parentByNodeId.get(nodeId);
    const seen = new Set([nodeId]);
    while (current && !seen.has(current)) {
      seen.add(current);
      depth += 1;
      current = parentByNodeId.get(current);
    }
    return depth;
  };

  return project.graph.nodes
    .filter((node) => {
      const childIds = childIdsByNode.get(node.id) ?? [];
      return childIds.length > 0 &&
        (node.type === "root_kpi" || node.type === "calculated") &&
        !node.formula?.trim();
    })
    .map((node) => ({
      nodeId: node.id,
      name: node.name,
      depth: depthFor(node.id),
      childIds: childIdsByNode.get(node.id) ?? []
    }))
    .sort((left, right) => right.depth - left.depth || left.nodeId.localeCompare(right.nodeId));
}

export function summarizeNode(project: VdtProject, nodeId: string): NodeSummary | undefined {
  return summarizeProject(project, project.graph.nodes.length).nodes.find((node) => node.id === nodeId);
}

export function summarizeValidation(validation: ValidationResult): ValidationStateSummary {
  return {
    valid: validation.valid,
    errors: validation.errors.map(summarizeWarning),
    warnings: validation.warnings.map(summarizeWarning)
  };
}

export function summarizeCalculation(calculation: GraphCalculationResult): CalculationStateSummary {
  return {
    rootNodeId: calculation.rootNodeId,
    ...(isFiniteNumber(calculation.rootValue)
      ? { rootValue: calculation.rootValue }
      : {}),
    valueCount: Object.keys(calculation.values).length,
    errors: calculation.errors.map(summarizeWarning),
    warnings: calculation.warnings.map(summarizeWarning),
    tracePreview: calculation.trace.slice(0, 20).map(summarizeTraceItem)
  };
}

export function summarizeManualChanges(state: VdtAgentRunState, limit = MAX_MANUAL_CHANGES): ManualChangeSummary[] {
  return state.manualChanges.slice(-limit).map((entry) => ({
    observedAt: entry.observedAt,
    projectRevision: entry.projectRevision,
    kind: entry.change.kind,
    nodeId: entry.change.nodeId,
    edgeId: entry.change.edgeId,
    summary: entry.change.summary
  }));
}

export function summarizeEvents(events: VdtAgentEvent[], limit = MAX_RECENT_EVENTS): AgentEventSummary[] {
  return events.filter(isSignificantAgentEvent).slice(-limit).map((event) => ({
    id: event.id,
    seq: event.seq,
    type: event.type,
    phase: event.phase,
    title: event.title,
    message: event.message,
    metadata: event.metadata
  }));
}

function isSignificantAgentEvent(event: VdtAgentEvent): boolean {
  if (event.type === "tool_call_started" || event.type === "assistant_message") return false;
  if (event.type === "tool_call_completed" && event.metadata?.taskType === "agent_decision") return false;
  return true;
}

function summarizeWarning(warning: VdtWarning): ValidationIssueSummary {
  const repairHints = repairHintsForWarning(warning);
  return {
    type: warning.type,
    severity: warning.severity,
    message: warning.message,
    ...(warning.nodeId !== undefined ? { nodeId: warning.nodeId } : {}),
    ...(warning.edgeId !== undefined ? { edgeId: warning.edgeId } : {}),
    ...(repairHints !== undefined ? { repairHints } : {})
  };
}

function summarizeTraceItem(item: CalculationTraceItem): CalculationTraceItem {
  return {
    nodeId: item.nodeId,
    nodeName: item.nodeName,
    ...(item.formula !== undefined ? { formula: item.formula } : {}),
    ...(item.resolvedFormula !== undefined
      ? { resolvedFormula: item.resolvedFormula }
      : {}),
    ...(isFiniteNumber(item.value) ? { value: item.value } : {}),
    ...(item.unit !== undefined ? { unit: item.unit } : {}),
    inputs: item.inputs.map((input) => ({
      nodeId: input.nodeId,
      nodeName: input.nodeName,
      ...(isFiniteNumber(input.value) ? { value: input.value } : {}),
      ...(input.unit !== undefined ? { unit: input.unit } : {})
    }))
  };
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function repairHintsForWarning(warning: VdtWarning): string[] | undefined {
  if (warning.type === "unknown_reference") {
    return [
      "Use formula.check_references to identify missing ids.",
      "Use formula.suggest_reference_repair or vdt.repair_missing_formula_reference."
    ];
  }
  if (warning.type === "formula_parse_error") {
    return ["Use formula.parse, then vdt.set_formula with a parser-valid expression."];
  }
  if (warning.type === "invalid_graph") {
    return ["Use project.get_node and a repair tool, or ask the user if the intended graph relation is ambiguous."];
  }
  if (warning.type === "missing_value") {
    return ["Ask the user for the missing value or add an assumption node with a baselineValue."];
  }
  return undefined;
}
