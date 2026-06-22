import { importProjectJson, type VdtAiTaskType, type VdtProject } from "@vdt-studio/vdt-core";
import {
  deepenNodeContextSchema,
  executiveSummaryInputSchema,
  explainScenarioInputSchema,
  resolveAiTaskType,
  simplifyBranchContextSchema,
  suggestAlternativeContextSchema,
  suggestFormulaContextSchema,
  TASK_LIMITS,
  type RunAiTaskInputMap,
  type VdtAiTaskLimits
} from "@vdt-studio/ai-harness";

/** Bounded AI tasks served by `/api/ai/run-task`. Tree generation uses `/api/ai/generate-vdt`. */
export const RUN_TASK_TYPES = [
  "deepen_node",
  "simplify_branch",
  "suggest_alternative",
  "suggest_formula",
  "review_model",
  "check_units",
  "identify_missing_drivers",
  "identify_duplicate_drivers",
  "explain_node",
  "explain_scenario",
  "generate_executive_summary"
] as const satisfies readonly VdtAiTaskType[];

export type RunTaskType = (typeof RUN_TASK_TYPES)[number];

const RUN_TASK_TYPE_SET = new Set<string>(RUN_TASK_TYPES);

const NODE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

export interface RunTaskRequestBody {
  taskType: string;
  input: Record<string, unknown>;
  providerId?: string;
  providerConfig?: Record<string, unknown>;
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readNodeId(value: unknown, field: string): string {
  if (typeof value !== "string" || !NODE_ID_PATTERN.test(value)) {
    throw new Error(`${field} must be a valid node id.`);
  }
  return value;
}

function readOptionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a number.`);
  }
  return value;
}

function readProject(value: unknown, limits: VdtAiTaskLimits): VdtProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("input.project is required.");
  }

  let project: VdtProject;
  try {
    project = importProjectJson(JSON.stringify(value));
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "input.project is invalid.");
  }

  const maxNodes = limits.maxNodes ?? 40;
  const maxEdges = limits.maxEdges ?? 80;
  if (project.graph.nodes.length > maxNodes) {
    throw new Error(`input.project exceeds ${maxNodes} nodes for this task.`);
  }
  if (project.graph.edges.length > maxEdges) {
    throw new Error(`input.project exceeds ${maxEdges} edges for this task.`);
  }

  return project;
}

function readOptionalContext<T>(
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  value: unknown,
  field: string
): T | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${field} is invalid.`);
  }
  return parsed.data;
}

function readCalculationSummary(value: unknown) {
  const parsed = explainScenarioInputSchema.shape.calculationSummary.safeParse(value);
  if (!parsed.success) {
    throw new Error("input.calculationSummary is invalid.");
  }
  return parsed.data;
}

function readTopDrivers(value: unknown) {
  const parsed = executiveSummaryInputSchema.shape.topDrivers.safeParse(value);
  if (!parsed.success) {
    throw new Error("input.topDrivers is invalid.");
  }
  return parsed.data;
}

export function resolveRunTaskType(rawTaskType: unknown): RunTaskType {
  if (typeof rawTaskType !== "string" || rawTaskType.trim().length === 0) {
    throw new Error("taskType is required.");
  }

  const resolved = resolveAiTaskType(rawTaskType.trim());
  if (resolved === "generate_tree") {
    throw new Error("generate_tree must use /api/ai/generate-vdt.");
  }
  if (!RUN_TASK_TYPE_SET.has(resolved)) {
    throw new Error(`Unsupported taskType: ${rawTaskType}`);
  }
  return resolved;
}

export function parseRunTaskRequest(body: RunTaskRequestBody): {
  taskType: RunTaskType;
  input: RunAiTaskInputMap[RunTaskType];
} {
  const taskType = resolveRunTaskType(body.taskType);
  const limits = TASK_LIMITS[taskType];
  const input = readRecord(body.input, "input");
  const project = readProject(input.project, limits);

  switch (taskType) {
    case "deepen_node": {
      const context = readOptionalContext(deepenNodeContextSchema, input.context, "input.context");
      return {
        taskType,
        input: {
          project,
          nodeId: readNodeId(input.nodeId, "input.nodeId"),
          ...(context ? { context } : {})
        }
      };
    }
    case "simplify_branch": {
      const context = readOptionalContext(simplifyBranchContextSchema, input.context, "input.context");
      return {
        taskType,
        input: {
          project,
          branchRootNodeId: readNodeId(input.branchRootNodeId, "input.branchRootNodeId"),
          ...(context ? { context } : {})
        }
      };
    }
    case "suggest_alternative": {
      const context = readOptionalContext(suggestAlternativeContextSchema, input.context, "input.context");
      return {
        taskType,
        input: {
          project,
          targetNodeId: readNodeId(input.targetNodeId, "input.targetNodeId"),
          ...(context ? { context } : {})
        }
      };
    }
    case "suggest_formula": {
      const context = readOptionalContext(suggestFormulaContextSchema, input.context, "input.context");
      return {
        taskType,
        input: {
          project,
          nodeId: readNodeId(input.nodeId, "input.nodeId"),
          ...(context ? { context } : {})
        }
      };
    }
    case "review_model":
    case "check_units":
    case "identify_missing_drivers":
    case "identify_duplicate_drivers":
      return { taskType, input: { project } };
    case "explain_node":
      return {
        taskType,
        input: {
          project,
          nodeId: readNodeId(input.nodeId, "input.nodeId")
        }
      };
    case "explain_scenario":
      return {
        taskType,
        input: {
          project,
          scenarioId: readNodeId(input.scenarioId, "input.scenarioId"),
          calculationSummary: readCalculationSummary(input.calculationSummary)
        }
      };
    case "generate_executive_summary": {
      const rootValue = readOptionalNumber(input.rootValue, "input.rootValue");
      const topDrivers = readTopDrivers(input.topDrivers);
      return {
        taskType,
        input: {
          project,
          ...(rootValue !== undefined ? { rootValue } : {}),
          ...(topDrivers ? { topDrivers } : {})
        }
      };
    }
    default: {
      const exhaustive: never = taskType;
      throw new Error(`Unsupported taskType: ${exhaustive}`);
    }
  }
}

export function assertRunTaskBodySize(bodyText: string, taskType: RunTaskType) {
  const maxBytes = TASK_LIMITS[taskType].maxInputBytes;
  if (bodyText.length > maxBytes) {
    throw new Error(`Request body must be ${maxBytes} bytes or fewer for ${taskType}.`);
  }
}
