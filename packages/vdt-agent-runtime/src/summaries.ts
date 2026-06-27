import type {
  GraphCalculationResult,
  ValidationResult,
  VdtProject,
  VdtWarning
} from "@vdt-studio/vdt-core";
import type {
  AgentEventSummary,
  CalculationStateSummary,
  ManualChangeSummary,
  NodeSummary,
  ProjectSummary,
  ValidationIssueSummary,
  ValidationStateSummary,
  VdtAgentEvent,
  VdtAgentRunState
} from "./types";

export const MAX_CONTEXT_NODES = 60;
export const MAX_RECENT_EVENTS = 30;
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
    rootValue: calculation.rootValue,
    valueCount: Object.keys(calculation.values).length,
    errors: calculation.errors.map(summarizeWarning),
    warnings: calculation.warnings.map(summarizeWarning),
    tracePreview: calculation.trace.slice(0, 20)
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
  return events.slice(-limit).map((event) => ({
    id: event.id,
    seq: event.seq,
    type: event.type,
    phase: event.phase,
    title: event.title,
    message: event.message,
    metadata: event.metadata
  }));
}

function summarizeWarning(warning: VdtWarning): ValidationIssueSummary {
  return {
    type: warning.type,
    severity: warning.severity,
    message: warning.message,
    nodeId: warning.nodeId,
    edgeId: warning.edgeId,
    repairHints: repairHintsForWarning(warning)
  };
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
