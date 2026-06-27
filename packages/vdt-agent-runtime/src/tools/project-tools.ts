import { z } from "zod";
import { extractFormulaReferences, type VdtProject } from "@vdt-studio/vdt-core";
import { AgentToolError, type AgentTool } from "../tool-registry";
import { summarizeManualChanges, summarizeNode, summarizeProject } from "../summaries";
import type { NodeSummary } from "../types";

export function createProjectTools(): AgentTool[] {
  return [
    getCurrentProjectTool,
    readCurrentProjectTool,
    getSelectedNodeTool,
    getNodeTool,
    getSubtreeTool,
    getRecentManualChangesTool,
    observeManualChangeTool
  ];
}

const getCurrentProjectTool: AgentTool = {
  name: "project.get_current",
  description: "Read the compact current project summary.",
  inputSchema: z.object({}),
  outputSchema: z.record(z.unknown()),
  phase: "planning_decomposition",
  run(context) {
    const project = currentProject(context);
    return { project: project ? summarizeProject(project) : null };
  }
};

const readCurrentProjectTool: AgentTool = {
  name: "project.read_current",
  description: "Legacy alias for project.get_current.",
  inputSchema: z.object({}),
  outputSchema: z.record(z.unknown()),
  phase: "planning_decomposition",
  run(context) {
    const project = currentProject(context);
    return { project: project ? summarizeProject(project) : null };
  }
};

const getSelectedNodeTool: AgentTool = {
  name: "project.get_selected_node",
  description: "Read the selected node with compact parent and child summaries.",
  inputSchema: z.object({}),
  outputSchema: z.record(z.unknown()),
  phase: "planning_decomposition",
  run(context) {
    const project = requireProject(context);
    const selectedNodeId = context.store.getState(context.runId).request.input.selectedNodeId;
    if (!selectedNodeId) return { node: null, children: [], parents: [] };
    return nodeNeighborhood(project, selectedNodeId);
  }
};

const getNodeTool: AgentTool = {
  name: "project.get_node",
  description: "Read one node with compact parent, child, and formula reference context.",
  inputSchema: z.object({
    nodeId: z.string().min(1).max(160)
  }),
  outputSchema: z.record(z.unknown()),
  phase: "planning_decomposition",
  run(context, input) {
    return nodeNeighborhood(requireProject(context), input.nodeId);
  }
};

const getSubtreeTool: AgentTool = {
  name: "project.get_subtree",
  description: "Read a compact subtree under a node.",
  inputSchema: z.object({
    rootNodeId: z.string().min(1).max(160),
    depth: z.number().int().min(1).max(6).optional()
  }),
  outputSchema: z.record(z.unknown()),
  phase: "planning_decomposition",
  run(context, input) {
    const project = requireProject(context);
    const maxDepth = input.depth ?? 2;
    const included = new Set<string>([input.rootNodeId]);
    let frontier = [input.rootNodeId];
    for (let depth = 0; depth < maxDepth; depth += 1) {
      const next: string[] = [];
      for (const nodeId of frontier) {
        for (const edge of project.graph.edges.filter((candidate) => candidate.sourceNodeId === nodeId)) {
          if (!included.has(edge.targetNodeId)) {
            included.add(edge.targetNodeId);
            next.push(edge.targetNodeId);
          }
        }
      }
      frontier = next;
    }
    const filtered: VdtProject = {
      ...project,
      graph: {
        nodes: project.graph.nodes.filter((node) => included.has(node.id)),
        edges: project.graph.edges.filter((edge) => included.has(edge.sourceNodeId) && included.has(edge.targetNodeId))
      }
    };
    return { subtree: summarizeProject(filtered, 60) };
  }
};

const getRecentManualChangesTool: AgentTool = {
  name: "project.get_recent_manual_changes",
  description: "Read recent user-originated manual changes observed by the agent.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(50).optional()
  }),
  outputSchema: z.record(z.unknown()),
  phase: "planning_decomposition",
  run(context, input) {
    return { manualChanges: summarizeManualChanges(context.store.getState(context.runId), input.limit ?? 20) };
  }
};

const observeManualChangeTool: AgentTool = {
  name: "project.observe_manual_change",
  description: "Record a user-originated manual project change in agent context.",
  inputSchema: z.object({
    kind: z.string().min(1).max(120),
    nodeId: z.string().max(160).optional(),
    edgeId: z.string().max(160).optional(),
    summary: z.string().max(500).optional()
  }),
  outputSchema: z.object({ observed: z.boolean() }),
  phase: "planning_decomposition",
  run(context, input) {
    context.store.observeManualChange(context.runId, {
      change: {
        kind: input.kind as never,
        nodeId: input.nodeId,
        edgeId: input.edgeId,
        summary: input.summary
      }
    });
    return { observed: true };
  }
};

function currentProject(context: Parameters<AgentTool["run"]>[0]): VdtProject | undefined {
  const snapshot = context.store.getSnapshot(context.runId);
  return context.builder?.getProject() ?? snapshot.draftProject ?? snapshot.project;
}

function requireProject(context: Parameters<AgentTool["run"]>[0]): VdtProject {
  const project = currentProject(context);
  if (!project) throw new AgentToolError("NO_DRAFT_PROJECT", "No draft project is available.");
  return project;
}

function nodeNeighborhood(project: VdtProject, nodeId: string) {
  const node = summarizeNode(project, nodeId);
  if (!node) throw new AgentToolError("NODE_NOT_FOUND", `Node "${nodeId}" was not found.`);
  const children = project.graph.edges
    .filter((edge) => edge.sourceNodeId === nodeId)
    .map((edge) => summarizeNode(project, edge.targetNodeId))
    .filter((summary): summary is NodeSummary => Boolean(summary));
  const parents = project.graph.edges
    .filter((edge) => edge.targetNodeId === nodeId)
    .map((edge) => summarizeNode(project, edge.sourceNodeId))
    .filter((summary): summary is NodeSummary => Boolean(summary));
  const formulasReferencingNode = project.graph.nodes
    .filter((candidate) => {
      if (!candidate.formula) return false;
      try {
        return extractFormulaReferences(candidate.formula).includes(nodeId);
      } catch {
        return false;
      }
    })
    .map((candidate) => candidate.id);
  return { node, children, parents, formulasReferencingNode };
}
