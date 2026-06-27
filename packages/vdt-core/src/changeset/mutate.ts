import { parseFormula } from "../formula/parser";
import { FormulaParseError } from "../formula/ast";
import type { VdtEdge, VdtNode, VdtProject, VdtWarning } from "../types";
import { cloneProject, nowIso, warning } from "../utils";
import type {
  VdtChangeSet,
  VdtEdgeChange,
  VdtNodeAddition,
  VdtNodeDeletion,
  VdtNodeUpdate
} from "./types";

export interface FilteredChangeSet {
  additions: VdtNodeAddition[];
  updates: VdtNodeUpdate[];
  deletions: VdtNodeDeletion[];
  edgeChanges: VdtEdgeChange[];
}

export function filterChangeSet(changeSet: VdtChangeSet, selection?: ReadonlySet<string>): FilteredChangeSet {
  const isSelected = (id: string) => !selection || selection.has(id);

  return {
    additions: changeSet.additions.filter((entry) => isSelected(entry.id)),
    updates: changeSet.updates.filter((entry) => isSelected(entry.id)),
    deletions: changeSet.deletions.filter((entry) => isSelected(entry.id)),
    edgeChanges: changeSet.edgeChanges.filter((entry) => isSelected(entry.id))
  };
}

function defaultNodeType(addition: VdtNodeAddition): VdtNode["type"] {
  if (addition.type) {
    return addition.type;
  }

  return addition.relation === "contextual_influence" ? "external_factor" : "input";
}

function additionToNode(addition: VdtNodeAddition, timestamp: string): VdtNode {
  return {
    id: addition.nodeId,
    name: addition.name,
    description: addition.description,
    type: defaultNodeType(addition),
    status: "ai_suggested",
    unit: addition.unit,
    formula: addition.formula,
    value: addition.value,
    baselineValue: addition.baselineValue,
    aiGenerated: true,
    aiConfidence: addition.aiConfidence,
    aiRationale: addition.aiRationale,
    assumptions: addition.assumptions,
    tags: addition.tags,
    owner: addition.owner,
    controllability: addition.controllability,
    materiality: addition.materiality,
    fixedInScenario: addition.fixedInScenario,
    dataMapping: addition.dataMapping,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function additionToEdge(addition: VdtNodeAddition): VdtEdge {
  return {
    id: `edge_${addition.parentNodeId}_${addition.nodeId}`,
    sourceNodeId: addition.parentNodeId,
    targetNodeId: addition.nodeId,
    relation: addition.relation,
    label: "AI proposed",
    aiGenerated: true,
    aiConfidence: addition.aiConfidence
  };
}

export function collectChangeSetStructureWarnings(
  changeSet: VdtChangeSet,
  project: VdtProject,
  filtered: FilteredChangeSet
): VdtWarning[] {
  const errors: VdtWarning[] = [];
  const seenEntryIds = new Set<string>();

  for (const entry of [
    ...changeSet.additions,
    ...changeSet.updates,
    ...changeSet.deletions,
    ...changeSet.edgeChanges
  ]) {
    if (seenEntryIds.has(entry.id)) {
      errors.push(
        warning({
          severity: "error",
          type: "invalid_graph",
          message: `Duplicate change entry id: ${entry.id}`
        })
      );
    }
    seenEntryIds.add(entry.id);
  }

  const existingNodeIds = new Set(project.graph.nodes.map((node) => node.id));
  const proposedNodeIds = new Set<string>();

  for (const addition of filtered.additions) {
    if (proposedNodeIds.has(addition.nodeId)) {
      errors.push(
        warning({
          severity: "error",
          type: "invalid_graph",
          message: `Duplicate proposed node id in change set: ${addition.nodeId}`,
          nodeId: addition.nodeId
        })
      );
    }
    proposedNodeIds.add(addition.nodeId);

    if (existingNodeIds.has(addition.nodeId)) {
      errors.push(
        warning({
          severity: "error",
          type: "invalid_graph",
          message: `Addition targets existing node id: ${addition.nodeId}`,
          nodeId: addition.nodeId
        })
      );
    }
  }

  return errors;
}

export function collectFormulaValidationWarnings(filtered: FilteredChangeSet): VdtWarning[] {
  const errors: VdtWarning[] = [];

  const validateFormula = (formula: string | undefined, nodeId: string, nodeName: string) => {
    if (!formula?.trim()) {
      return;
    }

    try {
      parseFormula(formula);
    } catch (error) {
      errors.push(
        warning({
          severity: "error",
          type: "formula_parse_error",
          message:
            error instanceof FormulaParseError
              ? `The formula for ${nodeName} cannot be parsed: ${error.message}`
              : `The formula for ${nodeName} cannot be parsed.`,
          nodeId
        })
      );
    }
  };

  for (const addition of filtered.additions) {
    validateFormula(addition.formula, addition.nodeId, addition.name);
  }

  for (const update of filtered.updates) {
    if (update.patch.formula !== undefined) {
      validateFormula(update.patch.formula, update.nodeId, update.nodeId);
    }
  }

  return errors;
}

export function mutateProjectGraph(
  project: VdtProject,
  filtered: FilteredChangeSet,
  options?: { touchUpdatedAt?: boolean }
): VdtProject {
  const timestamp = nowIso();
  const next = cloneProject(project);
  let nodes = [...next.graph.nodes];
  let edges = [...next.graph.edges];

  for (const addition of filtered.additions) {
    nodes.push(additionToNode(addition, timestamp));
    edges.push(additionToEdge(addition));
  }

  for (const change of filtered.edgeChanges) {
    if (change.action === "add") {
      edges.push({
        id: change.edge.id,
        sourceNodeId: change.edge.sourceNodeId,
        targetNodeId: change.edge.targetNodeId,
        relation: change.edge.relation,
        label: change.edge.label,
        aiGenerated: change.edge.aiGenerated ?? true,
        aiConfidence: change.edge.aiConfidence
      });
    }
  }

  for (const update of filtered.updates) {
    nodes = nodes.map((node) => {
      if (node.id !== update.nodeId) {
        return node;
      }

      const patch = update.patch;
      return {
        ...node,
        ...patch,
        updatedAt: timestamp
      };
    });
  }

  for (const change of filtered.edgeChanges) {
    if (change.action === "update") {
      edges = edges.map((edge) => {
        if (edge.id !== change.edgeId) {
          return edge;
        }

        return {
          ...edge,
          ...change.patch
        };
      });
    }
  }

  for (const change of filtered.edgeChanges) {
    if (change.action === "remove") {
      edges = edges.filter((edge) => edge.id !== change.edgeId);
    }
  }

  for (const deletion of filtered.deletions) {
    if (deletion.cascadeEdges) {
      edges = edges.filter(
        (edge) => edge.sourceNodeId !== deletion.nodeId && edge.targetNodeId !== deletion.nodeId
      );
    }

    nodes = nodes.filter((node) => node.id !== deletion.nodeId);
  }

  if (options?.touchUpdatedAt) {
    next.updatedAt = timestamp;
  }

  next.graph = { nodes, edges };
  return next;
}
