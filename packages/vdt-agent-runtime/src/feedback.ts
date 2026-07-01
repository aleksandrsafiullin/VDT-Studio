import { z } from "zod";
import type {
  AgentToolResultEnvelope,
  ValidationStateSummary
} from "./types";

export type AgentFeedbackSeverity = "info" | "warning" | "error";

export type AgentFeedbackKind =
  | "schema_validation_failed"
  | "forbidden_field"
  | "unknown_tool"
  | "invalid_tool_args"
  | "tool_failed"
  | "graph_validation_failed"
  | "calculation_failed"
  | "finish_rejected"
  | "business_rule_failed"
  | "recipe_incomplete"
  | "research_required"
  | "research_disabled";

export interface AgentStructuredFeedback {
  id: string;
  kind: AgentFeedbackKind;
  severity: AgentFeedbackSeverity;
  message: string;
  target?: {
    taskType?: "orchestrator_first_response" | "agent_decision";
    toolName?: string;
    nodeId?: string;
    fieldPath?: string;
  } | undefined;
  expected?: unknown;
  actual?: unknown;
  suggestedNextTools?: string[] | undefined;
  retryable: boolean;
  createdAt: string;
}

export function createStructuredFeedback(
  input: Omit<AgentStructuredFeedback, "id" | "createdAt">
    & { id?: string | undefined; createdAt?: string | undefined }
): AgentStructuredFeedback {
  return {
    ...input,
    id: input.id ?? `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: input.createdAt ?? new Date().toISOString()
  };
}

export function feedbackFromZodError(
  error: z.ZodError,
  target?: AgentStructuredFeedback["target"]
): AgentStructuredFeedback {
  const firstIssue = error.issues[0];
  const fieldPath = firstIssue?.path.length ? firstIssue.path.join(".") : undefined;
  return createStructuredFeedback({
    kind: "schema_validation_failed",
    severity: "error",
    message: error.issues.map((issue) => issue.message).join("; ") || "Structured output did not match the required schema.",
    target: {
      ...target,
      ...(fieldPath ? { fieldPath } : {})
    },
    expected: "Valid AgentDecision JSON matching the schema.",
    actual: error.issues,
    retryable: true
  });
}

export function feedbackFromForbiddenFields(fields: readonly string[]): AgentStructuredFeedback {
  return createStructuredFeedback({
    kind: "forbidden_field",
    severity: "error",
    message: `AgentDecision included forbidden full-plan fields: ${fields.join(", ")}.`,
    target: { taskType: "agent_decision" },
    expected: "A single small AgentDecision without full graph, full project, nodes, edges, driverPlan, or selectedSkillIds.",
    actual: fields,
    suggestedNextTools: ["skill.search", "skill.read", "skill.compile_recipe", "vdt.create_draft"],
    retryable: true
  });
}

export function feedbackFromToolEnvelope(envelope: AgentToolResultEnvelope): AgentStructuredFeedback | undefined {
  if (envelope.ok) return undefined;
  const code = envelope.error?.code ?? "TOOL_FAILED";
  const message = envelope.error?.message ?? "Tool failed.";
  return createStructuredFeedback({
    kind: feedbackKindForToolError(code),
    severity: "error",
    message,
    target: { toolName: envelope.toolName },
    actual: envelope.error?.details ?? envelope.error,
    suggestedNextTools: suggestedToolsForToolError(code),
    retryable: true
  });
}

export function feedbackFromValidation(validation: ValidationStateSummary): AgentStructuredFeedback | undefined {
  if (validation.valid) return undefined;
  const firstError = validation.errors[0];
  const firstWarning = validation.warnings[0];
  const issue = firstError ?? firstWarning;
  if (!issue) return undefined;
  return createStructuredFeedback({
    kind: issue.severity === "error" ? "graph_validation_failed" : "business_rule_failed",
    severity: issue.severity === "error" ? "error" : "warning",
    message: issue.message,
    target: {
      ...(issue.nodeId ? { nodeId: issue.nodeId } : {})
    },
    actual: {
      errors: validation.errors,
      warnings: validation.warnings
    },
    suggestedNextTools: issue.repairHints?.length
      ? ["vdt.repair_missing_formula_reference", "vdt.update_node", "vdt.set_formula"]
      : ["vdt.update_node", "vdt.set_formula", "user.ask"],
    retryable: true
  });
}

export function feedbackFromFinishError(error: unknown, validation?: ValidationStateSummary | undefined): AgentStructuredFeedback {
  const message = error instanceof Error ? error.message : "Cannot finish run.";
  const kind: AgentFeedbackKind = /calculation|finite/i.test(message)
    ? "calculation_failed"
    : "finish_rejected";
  return createStructuredFeedback({
    kind,
    severity: "error",
    message,
    target: { toolName: "finish" },
    actual: validation,
    suggestedNextTools: kind === "calculation_failed"
      ? ["vdt.calculate", "formula.suggest_reference_repair", "vdt.set_formula", "user.ask"]
      : ["vdt.validate", "vdt.update_node", "vdt.set_formula", "user.ask"],
    retryable: true
  });
}

export function formatFeedbackForPrompt(feedbacks: readonly AgentStructuredFeedback[] | undefined): string {
  if (!feedbacks?.length) return "[]";
  return JSON.stringify(
    feedbacks.map((feedback) => ({
      kind: feedback.kind,
      severity: feedback.severity,
      message: feedback.message,
      target: feedback.target,
      expected: feedback.expected,
      actual: feedback.actual,
      suggestedNextTools: feedback.suggestedNextTools,
      retryable: feedback.retryable
    })),
    null,
    2
  );
}

function feedbackKindForToolError(code: string): AgentFeedbackKind {
  if (code === "UNKNOWN_TOOL") return "unknown_tool";
  if (code === "INVALID_TOOL_ARGS") return "invalid_tool_args";
  if (code === "RECIPE_INCOMPLETE") return "recipe_incomplete";
  if (code === "RESEARCH_DISABLED_BY_USER") return "research_disabled";
  if (code === "RESEARCH_PROVIDER_NOT_CONFIGURED") return "research_required";
  if (/VALIDATION|BUSINESS_RULE|DOMAIN_POLICY/i.test(code)) return "business_rule_failed";
  return "tool_failed";
}

function suggestedToolsForToolError(code: string): string[] | undefined {
  if (code === "UNKNOWN_TOOL") return ["skill.list"];
  if (code === "INVALID_TOOL_ARGS") return undefined;
  if (/MISSING_FORMULA_REFERENCE|MISSING_FORMULA_REFERENCES/i.test(code)) {
    return ["formula.suggest_reference_repair", "vdt.set_formula"];
  }
  if (/NO_DRAFT_PROJECT/i.test(code)) return ["vdt.create_draft"];
  if (/RESEARCH_DISABLED_BY_USER/i.test(code)) return ["skill.search", "skill.read", "user.ask"];
  if (/RESEARCH_PROVIDER_NOT_CONFIGURED/i.test(code)) return ["user.ask"];
  return undefined;
}
