import type { VdtAiTaskType } from "./contract";

export const VDT_SCHEMA_IDS = [
  "connection-test-v1",
  "generate-tree-v1",
  "deepen-node-v1",
  "review-model-v1"
] as const;

export type VdtSchemaId = (typeof VDT_SCHEMA_IDS)[number];

const schemaTasks: Record<VdtSchemaId, readonly VdtAiTaskType[]> = {
  "connection-test-v1": ["generate_tree"],
  "generate-tree-v1": ["generate_tree"],
  "deepen-node-v1": ["deepen_node"],
  "review-model-v1": ["review_model"]
};

export function isVdtSchemaId(value: string): value is VdtSchemaId {
  return (VDT_SCHEMA_IDS as readonly string[]).includes(value);
}

export function schemaSupportsTask(schemaId: VdtSchemaId, taskType: VdtAiTaskType): boolean {
  return schemaTasks[schemaId].includes(taskType);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getRegisteredJsonSchema(schemaId: VdtSchemaId): Record<string, unknown> {
  if (schemaId === "connection-test-v1") {
    return {
      type: "object",
      properties: { ok: { type: "boolean", const: true } },
      required: ["ok"],
      additionalProperties: false
    };
  }
  if (schemaId === "generate-tree-v1") {
    return {
      type: "object",
      properties: {
        projectTitle: { type: "string" },
        rootNodeId: { type: "string" },
        nodes: { type: "array", minItems: 1, items: { type: "object" } },
        edges: { type: "array", items: { type: "object" } },
        assumptions: { type: "array" },
        questionsForUser: { type: "array" },
        warnings: { type: "array", items: { type: "object" } }
      },
      required: ["projectTitle", "rootNodeId", "nodes", "edges", "assumptions", "questionsForUser", "warnings"],
      additionalProperties: true
    };
  }
  return { type: "object", additionalProperties: true };
}

export function validateRegisteredSchema(schemaId: VdtSchemaId, output: unknown): boolean {
  if (!isRecord(output)) return false;
  if (schemaId === "connection-test-v1") return output.ok === true;
  if (schemaId === "generate-tree-v1") {
    return (
      typeof output.projectTitle === "string" &&
      typeof output.rootNodeId === "string" &&
      Array.isArray(output.nodes) &&
      output.nodes.length > 0 &&
      Array.isArray(output.edges) &&
      Array.isArray(output.assumptions) &&
      Array.isArray(output.questionsForUser) &&
      Array.isArray(output.warnings)
    );
  }
  return true;
}
