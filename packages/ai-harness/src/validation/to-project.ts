import type { VdtProject, VdtWarning } from "@vdt-studio/vdt-core";
import { validateGraph, nowIso, warning } from "@vdt-studio/vdt-core";
import type { GenerateVdtInput } from "../types";
import type { GenerateVdtOutput } from "../schemas/generate-vdt";
import { validateGenerateVdtOutput } from "./validate-ai-output";

function idFromName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}

export function generateVdtOutputToProject(output: GenerateVdtOutput, input: GenerateVdtInput): VdtProject {
  const validated = validateGenerateVdtOutput(output);
  const now = nowIso();
  const project: VdtProject = {
    id: `project_${idFromName(validated.projectTitle || input.rootKpi) || "vdt"}`,
    name: validated.projectTitle,
    description: input.goal,
    industry: input.industry,
    businessContext: input.businessContext,
    rootNodeId: validated.rootNodeId,
    graph: {
      nodes: validated.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        description: node.description,
        type: node.type,
        status: "ai_suggested",
        unit: node.unit,
        formula: node.formula,
        aiGenerated: true,
        aiConfidence: node.aiConfidence,
        aiRationale: node.aiRationale,
        controllability: node.controllability,
        materiality: node.materiality,
        createdAt: now,
        updatedAt: now
      })),
      edges: validated.edges.map((edge) => ({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        relation: edge.relation,
        label: edge.label,
        aiGenerated: true,
        aiConfidence: edge.aiConfidence
      }))
    },
    scenarios: [],
    dataSources: [],
    aiSettings: {
      defaultProviderId: "mock"
    },
    aiReview: {
      assumptions: validated.assumptions,
      questionsForUser: validated.questionsForUser,
      warnings: validated.warnings.map((item) =>
        warning({
          severity: item.severity,
          type: "weak_business_logic",
          message: item.message,
          nodeId: item.nodeId,
          edgeId: item.edgeId
        })
      )
    },
    versions: [],
    createdAt: now,
    updatedAt: now
  };

  const rootNode = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  if (!rootNode || rootNode.type !== "root_kpi") {
    throw new Error(`AI output rootNodeId must reference a root_kpi node: ${project.rootNodeId}`);
  }

  const graphValidation = validateGraph(project.graph, project.rootNodeId);
  if (!graphValidation.valid || graphValidation.warnings.length > 0) {
    const messages = [...graphValidation.errors, ...graphValidation.warnings]
      .map((error: VdtWarning) => error.message)
      .join("; ");
    throw new Error(`AI output produced an invalid graph: ${messages}`);
  }

  return project;
}
