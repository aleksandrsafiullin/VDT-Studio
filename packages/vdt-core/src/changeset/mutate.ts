import { parseFormula } from "../formula/parser";
import { FormulaParseError } from "../formula/ast";
import type { VdtDataMapping, VdtDataSource, VdtEdge, VdtNode, VdtProject, VdtWarning } from "../types";
import { cloneProject, nowIso, warning } from "../utils";
import type {
  VdtChangeSet,
  VdtDataMappingChange,
  VdtDataSourceChange,
  VdtEdgeChange,
  VdtNodeAddition,
  VdtNodeDeletion,
  VdtNodeUpdate,
  VdtTaxonomyChange
} from "./types";

export interface FilteredChangeSet {
  additions: VdtNodeAddition[];
  updates: VdtNodeUpdate[];
  deletions: VdtNodeDeletion[];
  edgeChanges: VdtEdgeChange[];
  dataSourceChanges: VdtDataSourceChange[];
  dataMappingChanges: VdtDataMappingChange[];
  taxonomyChanges: VdtTaxonomyChange[];
}

export function filterChangeSet(changeSet: VdtChangeSet, selection?: ReadonlySet<string>): FilteredChangeSet {
  const isSelected = (id: string) => !selection || selection.has(id);

  return {
    additions: changeSet.additions.filter((entry) => isSelected(entry.id)),
    updates: changeSet.updates.filter((entry) => isSelected(entry.id)),
    deletions: changeSet.deletions.filter((entry) => isSelected(entry.id)),
    edgeChanges: changeSet.edgeChanges.filter((entry) => isSelected(entry.id)),
    dataSourceChanges: (changeSet.dataSourceChanges ?? []).filter((entry) => isSelected(entry.id)),
    dataMappingChanges: (changeSet.dataMappingChanges ?? []).filter((entry) => isSelected(entry.id)),
    taxonomyChanges: (changeSet.taxonomyChanges ?? []).filter((entry) => isSelected(entry.id))
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
    valueStatus: addition.valueStatus,
    valueSource: addition.valueSource,
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
    ...changeSet.edgeChanges,
    ...(changeSet.dataSourceChanges ?? []),
    ...(changeSet.dataMappingChanges ?? []),
    ...(changeSet.taxonomyChanges ?? [])
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
  const dataSourcesById = new Map(project.dataSources.map((source) => [source.id, source]));
  const existingDataSourceIds = new Set(dataSourcesById.keys());
  const proposedNodeIds = new Set<string>();
  const proposedDataSourceIds = new Set<string>();
  const proposedDataSourcesById = new Map<string, VdtDataSource>();

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

  for (const change of filtered.dataSourceChanges) {
    if (change.action === "add") {
      if (existingDataSourceIds.has(change.dataSource.id)) {
        errors.push(
          warning({
            severity: "error",
            type: "data_discovery_validation_failed",
            message: `Data source already exists: ${change.dataSource.id}`
          })
        );
      }
      if (proposedDataSourceIds.has(change.dataSource.id)) {
        errors.push(
          warning({
            severity: "error",
            type: "data_discovery_validation_failed",
            message: `Duplicate proposed data source id in change set: ${change.dataSource.id}`
          })
        );
      }
      proposedDataSourceIds.add(change.dataSource.id);
      proposedDataSourcesById.set(change.dataSource.id, change.dataSource);
    } else if (!existingDataSourceIds.has(change.sourceId) && !proposedDataSourceIds.has(change.sourceId)) {
      errors.push(
        warning({
          severity: "error",
          type: "data_discovery_validation_failed",
          message: `Data source update targets unknown source: ${change.sourceId}`
        })
      );
    }
  }

  for (const change of filtered.dataMappingChanges) {
    if (!existingNodeIds.has(change.nodeId) && !proposedNodeIds.has(change.nodeId)) {
      errors.push(
        warning({
          severity: "error",
          type: "data_discovery_validation_failed",
          message: `Data mapping targets unknown node: ${change.nodeId}`,
          nodeId: change.nodeId
        })
      );
    }
    const mappingError = validateDataMappingReference(
      change.mapping,
      dataSourcesById,
      proposedDataSourcesById
    );
    if (mappingError) {
      errors.push(
        warning({
          severity: "error",
          type: "data_discovery_validation_failed",
          message: mappingError,
          nodeId: change.nodeId
        })
      );
    }
  }

  for (const addition of filtered.additions) {
    if (!addition.dataMapping) continue;
    const mappingError = validateDataMappingReference(
      addition.dataMapping,
      dataSourcesById,
      proposedDataSourcesById
    );
    if (mappingError) {
      errors.push(
        warning({
          severity: "error",
          type: "data_discovery_validation_failed",
          message: mappingError,
          nodeId: addition.nodeId
        })
      );
    }
  }

  for (const change of filtered.taxonomyChanges) {
    const source = proposedDataSourcesById.get(change.sourceId) ?? dataSourcesById.get(change.sourceId);
    if (!source) {
      errors.push(
        warning({
          severity: "error",
          type: "data_discovery_validation_failed",
          message: `Taxonomy change references unknown data source: ${change.sourceId}`
        })
      );
      continue;
    }
    const table = source.schema?.tables.find((candidate) => candidate.tableId === change.taxonomy.sourceTableId);
    if (!table) {
      errors.push(
        warning({
          severity: "error",
          type: "data_discovery_validation_failed",
          message: `Taxonomy change references unknown table: ${change.taxonomy.sourceTableId}`
        })
      );
      continue;
    }
    const fields = new Set(table.fields.map((field) => field.name));
    const missingColumn = change.taxonomy.sourceColumns.find((column) => !fields.has(column));
    if (missingColumn) {
      errors.push(
        warning({
          severity: "error",
          type: "data_discovery_validation_failed",
          message: `Taxonomy change references unknown column: ${missingColumn}`
        })
      );
    }
  }

  return errors;
}

function validateDataMappingReference(
  mapping: VdtDataMapping,
  existingDataSourcesById: Map<string, VdtDataSource>,
  proposedDataSourcesById: Map<string, VdtDataSource>
): string | undefined {
  const source = proposedDataSourcesById.get(mapping.sourceId) ?? existingDataSourcesById.get(mapping.sourceId);
  if (!source) {
    return `Data mapping references unknown data source: ${mapping.sourceId}`;
  }

  const tableId = mapping.tableId ?? (source.schema?.tables.length === 1 ? source.schema.tables[0]?.tableId : undefined);
  if (!tableId) {
    return `Data mapping for field ${mapping.field} must specify a source table.`;
  }

  const table = source.schema?.tables.find((candidate) => candidate.tableId === tableId);
  if (!table) {
    return `Data mapping references unknown table: ${tableId}`;
  }

  if (mapping.field === "*" && mapping.aggregation === "count") {
    return undefined;
  }

  if (!table.fields.some((field) => field.name === mapping.field)) {
    return `Data mapping references unknown field: ${tableId}.${mapping.field}`;
  }

  return undefined;
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
  let dataSources = [...next.dataSources];

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

  for (const change of filtered.dataMappingChanges) {
    nodes = nodes.map((node) => {
      if (node.id !== change.nodeId) {
        return node;
      }

      return {
        ...node,
        type: node.type === "root_kpi" ? node.type : "data_mapped",
        dataMapping: change.mapping,
        valueSource: {
          ...node.valueSource,
          sourceTier: node.valueSource?.sourceTier ?? "file",
          confidence: node.valueSource?.confidence ?? confidenceLabel(change.mapping.confidence),
          note: node.valueSource?.note ?? "Derived from imported dataset analysis"
        },
        updatedAt: timestamp
      };
    });
  }

  for (const change of filtered.dataSourceChanges) {
    if (change.action === "add") {
      dataSources = [...dataSources.filter((source) => source.id !== change.dataSource.id), change.dataSource];
    } else {
      dataSources = dataSources.map((source) => (
        source.id === change.sourceId ? { ...source, ...change.patch } : source
      ));
    }
  }

  for (const change of filtered.taxonomyChanges) {
    dataSources = dataSources.map((source) => {
      if (source.id !== change.sourceId) {
        return source;
      }

      const semanticModel = source.semanticModel;
      if (!semanticModel) {
        return source;
      }

      const taxonomies = [
        ...semanticModel.taxonomies.filter((taxonomy) => taxonomy.id !== change.taxonomy.id),
        change.taxonomy
      ];
      return {
        ...source,
        semanticModel: {
          ...semanticModel,
          taxonomies
        }
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
  next.dataSources = dataSources;
  return next;
}

function confidenceLabel(confidence: number | undefined): "high" | "medium" | "low" {
  if (confidence === undefined) return "medium";
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.55) return "medium";
  return "low";
}
