import { applyChangeSet } from "../changeset/apply";
import type { VdtChangeSet, VdtNodePatch } from "../changeset/types";
import { calculateGraph } from "../formula/calculate";
import { parseFormula } from "../formula/parser";
import { layoutGraph } from "../graph/layout";
import { validateGraph } from "../graph/validation";
import type { VdtEdge, VdtNode, VdtProject, VdtScenario, VdtWarning } from "../types";
import { cloneProject } from "../utils";
import { stableSnakeId, uniqueId } from "./ids";
import type {
  AddDriverInput,
  AddEdgeInput,
  CreateDraftInput,
  DeleteNodeInput,
  LayoutOptions,
  SetFormulaInput,
  UpdateNodeInput,
  VdtBuilderCalculateResult,
  VdtBuilderEvent,
  VdtBuilderOperationResult,
  VdtBuilderOperationType,
  VdtBuilderSnapshotResult,
  VdtBuilderValidationResult
} from "./events";

export interface VdtBuilderSessionInput {
  project?: VdtProject | undefined;
  providerId?: string | undefined;
  now?: (() => string) | undefined;
}

export class VdtBuilderSession {
  private project: VdtProject;
  private revision = 0;
  private readonly events: VdtBuilderEvent[] = [];
  private readonly providerId: string;
  private readonly now: () => string;

  constructor(input: VdtBuilderSessionInput = {}) {
    this.project = input.project ? cloneProject(input.project) : createEmptyProject(input.now?.() ?? new Date().toISOString());
    this.providerId = input.providerId ?? "vdt_builder";
    this.now = input.now ?? (() => new Date().toISOString());
  }

  getProject(): VdtProject {
    return cloneProject(this.project);
  }

  getRevision(): number {
    return this.revision;
  }

  getEvents(): VdtBuilderEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  createDraft(input: CreateDraftInput): VdtBuilderOperationResult {
    const timestamp = this.now();
    const rootNodeId = stableSnakeId(input.rootKpi, "root_kpi");
    const rootNode: VdtNode = {
      id: rootNodeId,
      name: input.rootKpi.trim(),
      description: input.goal?.trim() || input.businessContext?.trim() || undefined,
      type: "root_kpi",
      status: "ai_suggested",
      unit: input.unit?.trim() || undefined,
      aiGenerated: true,
      aiConfidence: 0.78,
      aiRationale: "Created as the root KPI for the agent draft.",
      assumptions: input.timePeriod ? [`Time period: ${input.timePeriod}`] : undefined,
      position: { x: 48, y: 48 },
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.project = {
      id: `project_${rootNodeId}`,
      name: input.projectTitle.trim() || `${input.rootKpi.trim()} Driver Model`,
      description: input.goal?.trim() || undefined,
      industry: input.industry?.trim() || undefined,
      businessContext: input.businessContext?.trim() || undefined,
      rootNodeId,
      graph: {
        nodes: [rootNode],
        edges: []
      },
      scenarios: [defaultScenario(timestamp)],
      dataSources: [],
      aiSettings: {
        defaultProviderId: this.providerId
      },
      versions: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };

    return this.commit("create_draft", "Draft created", `Created draft project with root KPI "${rootNode.name}".`);
  }

  addDriver(input: AddDriverInput): VdtBuilderOperationResult {
    this.requireNode(input.parentNodeId);
    if (input.formula?.trim()) parseFormula(input.formula);

    const timestamp = this.now();
    const nodeIds = new Set(this.project.graph.nodes.map((node) => node.id));
    const nodeId = uniqueId(stableSnakeId(input.nodeId ?? input.name, "driver"), nodeIds);
    const edgeIds = new Set(this.project.graph.edges.map((edge) => edge.id));
    const edgeId = uniqueId(`edge_${input.parentNodeId}_${nodeId}`, edgeIds);
    const node: VdtNode = {
      id: nodeId,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      type: input.type ?? "input",
      status: "ai_suggested",
      unit: input.unit?.trim() || undefined,
      formula: input.formula?.trim() || undefined,
      aiGenerated: true,
      aiConfidence: 0.72,
      aiRationale: input.aiRationale?.trim() || "Added by the VDT builder as an agent driver.",
      assumptions: input.assumptions,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const edge: VdtEdge = {
      id: edgeId,
      sourceNodeId: input.parentNodeId,
      targetNodeId: nodeId,
      relation: input.relation ?? "positive_driver",
      aiGenerated: true,
      aiConfidence: 0.72
    };
    const changeSet: VdtChangeSet = {
      id: `changeset_${this.revision + 1}_${nodeId}`,
      taskType: "generate_tree",
      backendId: this.providerId,
      createdAt: timestamp,
      additions: [
        {
          id: `add_${nodeId}`,
          nodeId,
          parentNodeId: input.parentNodeId,
          relation: edge.relation,
          name: node.name,
          description: node.description,
          type: node.type,
          unit: node.unit,
          formula: node.formula,
          aiConfidence: node.aiConfidence,
          aiRationale: node.aiRationale,
          assumptions: node.assumptions
        }
      ],
      updates: [],
      deletions: [],
      edgeChanges: [
        {
          id: `edge_${edgeId}`,
          action: "add",
          edge
        }
      ],
      assumptions: input.assumptions ?? [],
      questions: [],
      warnings: []
    };

    this.project = {
      ...this.project,
      updatedAt: timestamp,
      graph: {
        nodes: [...this.project.graph.nodes, node],
        edges: [...this.project.graph.edges, edge]
      }
    };

    return this.commit(
      "add_driver",
      "Driver added",
      `Added "${node.name}" under "${this.requireNode(input.parentNodeId).name}".`,
      { changeSet, metadata: { nodeId, parentNodeId: input.parentNodeId } }
    );
  }

  updateNode(input: UpdateNodeInput): VdtBuilderOperationResult {
    this.requireNode(input.nodeId);
    if (input.patch.formula?.trim()) parseFormula(input.patch.formula);
    const timestamp = this.now();
    this.project = {
      ...this.project,
      updatedAt: timestamp,
      graph: {
        ...this.project.graph,
        nodes: this.project.graph.nodes.map((node) =>
          node.id === input.nodeId
            ? { ...node, ...cleanNodePatch(input.patch), updatedAt: timestamp }
            : node
        )
      }
    };
    const changeSet = this.changeSet({
      updates: [{ id: `update_${input.nodeId}_${this.revision + 1}`, nodeId: input.nodeId, patch: cleanNodePatch(input.patch) }]
    });
    return this.commit("update_node", "Node updated", `Updated node "${input.nodeId}".`, {
      changeSet,
      metadata: { nodeId: input.nodeId, patch: input.patch }
    });
  }

  deleteNode(input: DeleteNodeInput): VdtBuilderOperationResult {
    this.requireNode(input.nodeId);
    if (input.nodeId === this.project.rootNodeId) {
      throw new Error("Root node cannot be deleted.");
    }
    const timestamp = this.now();
    const touchingEdges = this.project.graph.edges.filter(
      (edge) => edge.sourceNodeId === input.nodeId || edge.targetNodeId === input.nodeId
    );
    if (touchingEdges.length > 0 && input.cascadeEdges !== true) {
      throw new Error("Node has connected edges. Pass cascadeEdges to delete it.");
    }
    this.project = {
      ...this.project,
      updatedAt: timestamp,
      graph: {
        nodes: this.project.graph.nodes.filter((node) => node.id !== input.nodeId),
        edges: this.project.graph.edges.filter((edge) => !touchingEdges.includes(edge))
      }
    };
    const changeSet = this.changeSet({
      deletions: [{ id: `delete_${input.nodeId}`, nodeId: input.nodeId, cascadeEdges: input.cascadeEdges }]
    });
    return this.commit("delete_node", "Node deleted", `Deleted node "${input.nodeId}".`, {
      changeSet,
      metadata: { nodeId: input.nodeId, removedEdgeIds: touchingEdges.map((edge) => edge.id) }
    });
  }

  addEdge(input: AddEdgeInput): VdtBuilderOperationResult {
    this.requireNode(input.sourceNodeId);
    this.requireNode(input.targetNodeId);
    const timestamp = this.now();
    const edgeIds = new Set(this.project.graph.edges.map((edge) => edge.id));
    const edgeId = uniqueId(input.edgeId ?? `edge_${input.sourceNodeId}_${input.targetNodeId}`, edgeIds);
    const edge: VdtEdge = {
      id: edgeId,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      relation: input.relation,
      label: input.label,
      aiGenerated: true,
      aiConfidence: 0.7
    };
    this.project = {
      ...this.project,
      updatedAt: timestamp,
      graph: {
        ...this.project.graph,
        edges: [...this.project.graph.edges, edge]
      }
    };
    const changeSet = this.changeSet({
      edgeChanges: [{ id: `edge_${edgeId}`, action: "add", edge }]
    });
    return this.commit("add_edge", "Edge added", `Added edge "${edgeId}".`, {
      changeSet,
      metadata: { edgeId, sourceNodeId: input.sourceNodeId, targetNodeId: input.targetNodeId }
    });
  }

  setFormula(input: SetFormulaInput): VdtBuilderOperationResult {
    parseFormula(input.formula);
    return this.updateNode({
      nodeId: input.nodeId,
      patch: {
        formula: input.formula.trim(),
        type: "calculated",
        status: "ai_suggested"
      }
    });
  }

  applyChangeSet(changeSet: VdtChangeSet, selection?: ReadonlySet<string>): VdtBuilderOperationResult {
    const selected = selection ?? collectChangeIds(changeSet);
    const applied = applyChangeSet(this.project, changeSet, selected);
    if (!applied.success) {
      const event = this.createEvent("apply_changeset", "Change set rejected", "Change set failed builder validation.", {
        changeSet,
        metadata: { warningCount: applied.warnings.length }
      });
      return {
        project: this.getProject(),
        revision: this.revision,
        changeSet,
        event,
        warnings: applied.warnings
      };
    }
    this.project = applied.project;
    return this.commit("apply_changeset", "Change set applied", "Applied validated change set to draft project.", {
      changeSet,
      metadata: { selectedChangeIds: [...selected] }
    });
  }

  validate(): VdtBuilderValidationResult {
    const validation = validateGraph(this.project);
    const event = this.createEvent(
      "validate",
      validation.valid ? "Graph validation passed" : "Graph validation found issues",
      validation.valid
        ? `Graph validation passed with ${validation.warnings.length} warning${validation.warnings.length === 1 ? "" : "s"}.`
        : `Graph validation found ${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"}.`,
      { metadata: { errors: validation.errors.length, warnings: validation.warnings.length } }
    );
    return { validation, revision: this.revision, event };
  }

  layout(options?: LayoutOptions): VdtBuilderOperationResult {
    const layout = layoutGraph(this.project.graph, this.project.rootNodeId, options);
    const timestamp = this.now();
    this.project = {
      ...this.project,
      updatedAt: timestamp,
      graph: {
        ...this.project.graph,
        nodes: this.project.graph.nodes.map((node) => ({
          ...node,
          position: layout.positions.get(node.id) ?? node.position ?? { x: 0, y: 0 },
          updatedAt: timestamp
        }))
      }
    };
    return this.commit("layout", "Graph layout applied", "Updated draft node positions.", {
      metadata: { width: layout.width, height: layout.height }
    });
  }

  calculate(): VdtBuilderCalculateResult {
    const calculation = calculateGraph(this.project);
    const event = this.createEvent(
      "calculate",
      "Graph calculation completed",
      `Calculated ${Object.keys(calculation.values).length} node value${Object.keys(calculation.values).length === 1 ? "" : "s"}.`,
      { metadata: { warnings: calculation.warnings.length, errors: calculation.errors.length } }
    );
    return { calculation, revision: this.revision, event };
  }

  snapshot(name: string): VdtProject {
    const timestamp = this.now();
    const snapshot = cloneProject(this.project);
    const version = {
      id: stableSnakeId(`version_${name}_${this.revision}`, "version"),
      name,
      projectSnapshot: snapshot,
      createdAt: timestamp
    };
    this.project = {
      ...this.project,
      updatedAt: timestamp,
      versions: [...this.project.versions, version]
    };
    this.recordEvent("snapshot", "Snapshot created", `Created builder snapshot "${name}".`, { metadata: { name } });
    return this.getProject();
  }

  snapshotResult(name: string): VdtBuilderSnapshotResult {
    const project = this.snapshot(name);
    const event = this.events[this.events.length - 1]!;
    return { project, revision: this.revision, event };
  }

  private requireNode(nodeId: string): VdtNode {
    const node = this.project.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new Error(`Node "${nodeId}" does not exist.`);
    return node;
  }

  private commit(
    type: VdtBuilderOperationType,
    title: string,
    message: string,
    options: { changeSet?: VdtChangeSet; metadata?: Record<string, unknown> } = {}
  ): VdtBuilderOperationResult {
    this.revision += 1;
    const validation = validateGraph(this.project);
    const event = this.recordEvent(type, title, message, options);
    return {
      project: this.getProject(),
      revision: this.revision,
      changeSet: options.changeSet,
      event,
      warnings: [...validation.errors, ...validation.warnings]
    };
  }

  private recordEvent(
    type: VdtBuilderOperationType,
    title: string,
    message: string,
    options: { changeSet?: VdtChangeSet; metadata?: Record<string, unknown> } = {}
  ): VdtBuilderEvent {
    const event = this.createEvent(type, title, message, options);
    this.events.push(event);
    return event;
  }

  private createEvent(
    type: VdtBuilderOperationType,
    title: string,
    message: string,
    options: { changeSet?: VdtChangeSet; metadata?: Record<string, unknown> } = {}
  ): VdtBuilderEvent {
    return {
      id: `builder_event_${this.events.length + 1}`,
      revision: this.revision,
      timestamp: this.now(),
      type,
      title,
      message,
      metadata: options.metadata,
      changeSet: options.changeSet
    };
  }

  private changeSet(input: Partial<Pick<VdtChangeSet, "additions" | "updates" | "deletions" | "edgeChanges" | "assumptions" | "questions" | "warnings">>): VdtChangeSet {
    return {
      id: `changeset_${this.revision + 1}`,
      taskType: "generate_tree",
      backendId: this.providerId,
      createdAt: this.now(),
      additions: input.additions ?? [],
      updates: input.updates ?? [],
      deletions: input.deletions ?? [],
      edgeChanges: input.edgeChanges ?? [],
      assumptions: input.assumptions ?? [],
      questions: input.questions ?? [],
      warnings: input.warnings ?? []
    };
  }
}

function createEmptyProject(timestamp: string): VdtProject {
  return {
    id: "draft_project",
    name: "Draft VDT",
    rootNodeId: "",
    graph: {
      nodes: [],
      edges: []
    },
    scenarios: [],
    dataSources: [],
    aiSettings: {
      defaultProviderId: "vdt_builder"
    },
    versions: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function defaultScenario(timestamp: string): VdtScenario {
  return {
    id: "base_scenario",
    name: "Base scenario",
    description: "Baseline values for the agent draft.",
    overrides: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function cleanNodePatch(patch: VdtNodePatch): VdtNodePatch {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as VdtNodePatch;
}

function collectChangeIds(changeSet: VdtChangeSet): Set<string> {
  return new Set([
    ...changeSet.additions.map((entry) => entry.id),
    ...changeSet.updates.map((entry) => entry.id),
    ...changeSet.deletions.map((entry) => entry.id),
    ...changeSet.edgeChanges.map((entry) => entry.id)
  ]);
}
