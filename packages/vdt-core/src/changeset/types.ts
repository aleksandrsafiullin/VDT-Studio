import type {
  VdtAiTaskType,
  VdtEdge,
  VdtEdgeRelation,
  VdtNode,
  VdtNodeType,
  VdtProject,
  VdtWarning
} from "../types";

/** Mutable node fields AI may propose via a change set (excludes layout, timestamps, computed values). */
export type VdtNodePatch = Partial<
  Pick<
    VdtNode,
    | "name"
    | "description"
    | "type"
    | "unit"
    | "formula"
    | "value"
    | "baselineValue"
    | "status"
    | "assumptions"
    | "tags"
    | "owner"
    | "controllability"
    | "materiality"
    | "fixedInScenario"
    | "aiConfidence"
    | "aiRationale"
    | "dataMapping"
  >
>;

export interface VdtNodeAddition {
  /** Stable change-entry id for selection UI (`toggleChangeSelection`). */
  id: string;
  /** Proposed graph node id. */
  nodeId: string;
  /** Parent node this addition connects from (deepen / simplify flows). */
  parentNodeId: string;
  /** Edge relation from parent to the new node. */
  relation: VdtEdgeRelation;
  name: string;
  description?: string | undefined;
  type?: VdtNodeType | undefined;
  unit?: string | undefined;
  formula?: string | undefined;
  value?: number | undefined;
  baselineValue?: number | undefined;
  aiConfidence?: number | undefined;
  aiRationale?: string | undefined;
  assumptions?: string[] | undefined;
  tags?: string[] | undefined;
  owner?: string | undefined;
  controllability?: VdtNode["controllability"];
  materiality?: VdtNode["materiality"];
  fixedInScenario?: VdtNode["fixedInScenario"];
  dataMapping?: VdtNode["dataMapping"];
}

export interface VdtNodeUpdate {
  id: string;
  nodeId: string;
  patch: VdtNodePatch;
}

export interface VdtNodeDeletion {
  id: string;
  nodeId: string;
  /** When true, remove edges touching the deleted node. */
  cascadeEdges?: boolean | undefined;
}

export type VdtEdgePatch = Partial<
  Pick<VdtEdge, "sourceNodeId" | "targetNodeId" | "relation" | "label" | "aiConfidence">
>;

export interface VdtEdgeChangeAdd {
  id: string;
  action: "add";
  edge: Pick<VdtEdge, "id" | "sourceNodeId" | "targetNodeId" | "relation"> & {
    label?: string | undefined;
    aiGenerated?: boolean | undefined;
    aiConfidence?: number | undefined;
  };
}

export interface VdtEdgeChangeRemove {
  id: string;
  action: "remove";
  edgeId: string;
}

export interface VdtEdgeChangeUpdate {
  id: string;
  action: "update";
  edgeId: string;
  patch: VdtEdgePatch;
}

export type VdtEdgeChange = VdtEdgeChangeAdd | VdtEdgeChangeRemove | VdtEdgeChangeUpdate;

export interface VdtChangeSet {
  id: string;
  taskType: VdtAiTaskType;
  backendId: string;
  createdAt: string;
  additions: VdtNodeAddition[];
  updates: VdtNodeUpdate[];
  deletions: VdtNodeDeletion[];
  edgeChanges: VdtEdgeChange[];
  assumptions: string[];
  questions: string[];
  warnings: VdtWarning[];
}

/** Structured graph diff for canvas highlighting after a change set is proposed. */
export interface VdtChangeSetDiff {
  addedNodeIds: string[];
  updatedNodeIds: string[];
  removedNodeIds: string[];
  addedEdgeIds: string[];
  updatedEdgeIds: string[];
  removedEdgeIds: string[];
}

export interface ApplyChangeSetResult {
  success: boolean;
  project: VdtProject;
  warnings: VdtWarning[];
}
