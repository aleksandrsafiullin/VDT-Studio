import type { VdtChangeSet, VdtNodePatch } from "../changeset/types";
import type { GraphLayoutOptions } from "../graph/layout";
import type { GraphCalculationResult, ValidationResult, VdtEdgeRelation, VdtNodeType, VdtProject, VdtWarning } from "../types";

export interface CreateDraftInput {
  projectTitle: string;
  rootKpi: string;
  unit?: string | undefined;
  timePeriod?: string | undefined;
  industry?: string | undefined;
  businessContext?: string | undefined;
  goal?: string | undefined;
}

export interface AddDriverInput {
  parentNodeId: string;
  nodeId?: string | undefined;
  name: string;
  type?: VdtNodeType | undefined;
  unit?: string | undefined;
  relation?: VdtEdgeRelation | undefined;
  formula?: string | undefined;
  description?: string | undefined;
  aiRationale?: string | undefined;
  assumptions?: string[] | undefined;
}

export interface UpdateNodeInput {
  nodeId: string;
  patch: VdtNodePatch;
}

export interface DeleteNodeInput {
  nodeId: string;
  cascadeEdges?: boolean | undefined;
}

export interface AddEdgeInput {
  sourceNodeId: string;
  targetNodeId: string;
  relation: VdtEdgeRelation;
  edgeId?: string | undefined;
  label?: string | undefined;
}

export interface SetFormulaInput {
  nodeId: string;
  formula: string;
}

export type LayoutOptions = GraphLayoutOptions;

export type VdtBuilderOperationType =
  | "create_draft"
  | "add_driver"
  | "update_node"
  | "delete_node"
  | "add_edge"
  | "set_formula"
  | "apply_changeset"
  | "layout"
  | "validate"
  | "calculate"
  | "snapshot";

export interface VdtBuilderEvent {
  id: string;
  revision: number;
  timestamp: string;
  type: VdtBuilderOperationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | undefined;
  changeSet?: VdtChangeSet | undefined;
}

export interface VdtBuilderOperationResult {
  project: VdtProject;
  revision: number;
  changeSet?: VdtChangeSet | undefined;
  event: VdtBuilderEvent;
  warnings: VdtWarning[];
}

export interface VdtBuilderSnapshotResult {
  project: VdtProject;
  revision: number;
  event: VdtBuilderEvent;
}

export interface VdtBuilderCalculateResult {
  calculation: GraphCalculationResult;
  revision: number;
  event: VdtBuilderEvent;
}

export interface VdtBuilderValidationResult {
  validation: ValidationResult;
  revision: number;
  event: VdtBuilderEvent;
}
