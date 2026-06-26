import { z } from "zod";
import type { VdtWarning } from "@vdt-studio/vdt-core";
import { validateGraph } from "@vdt-studio/vdt-core";
import type { AgentTool } from "../tool-registry";

export function createAiTaskTools(): AgentTool[] {
  return [checkUnitsTool, identifyMissingDriversTool, identifyDuplicateDriversTool, reviewModelTool];
}

const advisoryOutputSchema = z.object({
  assumptions: z.array(z.string()),
  questionsForUser: z.array(z.string()),
  warnings: z.array(z.object({
    severity: z.enum(["info", "warning", "error"]),
    message: z.string(),
    nodeId: z.string().optional(),
    edgeId: z.string().optional()
  }))
});

const checkUnitsTool: AgentTool = {
  name: "ai.check_units",
  description: "Run bounded unit consistency checks using deterministic validators.",
  inputSchema: z.object({}),
  outputSchema: advisoryOutputSchema,
  run(context) {
    const project = context.store.getSnapshot(context.runId).draftProject;
    if (!project) throw new Error("No draft project is available.");
    const validation = validateGraph(project);
    const warnings = [...validation.errors, ...validation.warnings]
      .filter((warning) => warning.type === "unit_mismatch" || warning.type === "unknown_reference" || warning.type === "formula_parse_error")
      .map(toAdvisoryWarning);
    mergeReview(context, { assumptions: [], questionsForUser: [], warnings });
    return { assumptions: [], questionsForUser: [], warnings };
  }
};

const identifyMissingDriversTool: AgentTool = {
  name: "ai.identify_missing_drivers",
  description: "Identify likely underdeveloped driver branches without external tool access.",
  inputSchema: z.object({}),
  outputSchema: advisoryOutputSchema,
  run(context) {
    const project = context.store.getSnapshot(context.runId).draftProject;
    if (!project) throw new Error("No draft project is available.");
    const childCounts = new Map<string, number>();
    for (const edge of project.graph.edges) {
      childCounts.set(edge.sourceNodeId, (childCounts.get(edge.sourceNodeId) ?? 0) + 1);
    }
    const warnings = project.graph.nodes
      .filter((node) => node.type === "calculated" && node.id !== project.rootNodeId && (childCounts.get(node.id) ?? 0) === 0)
      .slice(0, 10)
      .map((node) => ({
        severity: "warning" as const,
        message: `"${node.name}" is calculated but has no visible child drivers yet.`,
        ...(node.id ? { nodeId: node.id } : {})
      }));
    const questionsForUser = warnings.length > 0
      ? ["Which calculated branch should the agent deepen next?"]
      : [];
    mergeReview(context, { assumptions: [], questionsForUser, warnings });
    return { assumptions: [], questionsForUser, warnings };
  }
};

const identifyDuplicateDriversTool: AgentTool = {
  name: "ai.identify_duplicate_drivers",
  description: "Identify duplicate driver names in the current draft.",
  inputSchema: z.object({}),
  outputSchema: advisoryOutputSchema,
  run(context) {
    const project = context.store.getSnapshot(context.runId).draftProject;
    if (!project) throw new Error("No draft project is available.");
    const byName = new Map<string, string[]>();
    for (const node of project.graph.nodes) {
      const key = node.name.trim().toLowerCase();
      byName.set(key, [...(byName.get(key) ?? []), node.id]);
    }
    const warnings = [...byName]
      .filter(([, ids]) => ids.length > 1)
      .map(([name, ids]) => ({
        severity: "warning" as const,
        message: `Duplicate driver label "${name}" appears on ${ids.length} nodes.`,
        ...(ids[0] ? { nodeId: ids[0] } : {})
      }));
    mergeReview(context, { assumptions: [], questionsForUser: [], warnings });
    return { assumptions: [], questionsForUser: [], warnings };
  }
};

const reviewModelTool: AgentTool = {
  name: "ai.review_model",
  description: "Create a bounded model review summary from validation and visible structure.",
  inputSchema: z.object({}),
  outputSchema: advisoryOutputSchema,
  run(context) {
    const project = context.store.getSnapshot(context.runId).draftProject;
    if (!project) throw new Error("No draft project is available.");
    const validation = validateGraph(project);
    const assumptions = [
      "The first draft uses skill recipes and should be refined with actual business values.",
      "Formula structure is validated syntactically, but numeric assumptions still need owner review."
    ];
    const questionsForUser = validation.valid
      ? ["Which first-level driver should be deepened next?"]
      : ["Should the agent repair the validation issues before adding more detail?"];
    const warnings = [...validation.errors, ...validation.warnings].map(toAdvisoryWarning);
    mergeReview(context, { assumptions, questionsForUser, warnings });
    return { assumptions, questionsForUser, warnings };
  }
};

function toAdvisoryWarning(warning: VdtWarning) {
  return {
    severity: warning.severity,
    message: warning.message,
    ...(warning.nodeId ? { nodeId: warning.nodeId } : {}),
    ...(warning.edgeId ? { edgeId: warning.edgeId } : {})
  };
}

function mergeReview(
  context: Parameters<AgentTool["run"]>[0],
  result: { assumptions: string[]; questionsForUser: string[]; warnings: Array<{ severity: "info" | "warning" | "error"; message: string; nodeId?: string; edgeId?: string }> }
): void {
  const snapshot = context.store.getSnapshot(context.runId);
  const project = snapshot.draftProject;
  if (!project) return;
  context.store.updateRun(context.runId, {
    draftProject: {
      ...project,
      aiReview: {
        assumptions: [...new Set([...(project.aiReview?.assumptions ?? []), ...result.assumptions])],
        questionsForUser: [...new Set([...(project.aiReview?.questionsForUser ?? []), ...result.questionsForUser])],
        warnings: [
          ...(project.aiReview?.warnings ?? []),
          ...result.warnings.map((warning, index) => ({
            id: `agent_review_${snapshot.events.length}_${index}`,
            severity: warning.severity,
            type: "weak_business_logic" as const,
            message: warning.message,
            nodeId: warning.nodeId,
            edgeId: warning.edgeId
          }))
        ]
      }
    }
  });
}
