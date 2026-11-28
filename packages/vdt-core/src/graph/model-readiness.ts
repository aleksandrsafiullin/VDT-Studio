import { calculateGraph } from "../formula/calculate";
import { FormulaParseError } from "../formula/ast";
import { extractFormulaReferences } from "../formula/evaluator";
import type { GraphCalculationResult, ValidationResult, VdtProject, VdtWarning } from "../types";
import { inspectDecompositionHierarchy, getDecompositionContextGroupIds } from "./decomposition";
import { validateGraph } from "./validation";
import { hasTypedDecompositionRelationship, readDecompositionAssumptions } from "../operations/decomposition-assumption";
import { verifyDecompositionRelationship, type DecompositionRelationshipVerification } from "../operations/factor-probe";
import { readNodeBaselineValue } from "../utils";

export const WORKSPACE_MODEL_READINESS_POLICY_VERSION = "workspace-v1";
const relationshipLimit = 24;
export type ModelReadinessPurpose = "structural_model" | "calculated_baseline";

export interface ModelReadinessOptions {
  purpose: ModelReadinessPurpose;
  policyVersion?: string | undefined;
  requireDerivedRoot?: boolean | undefined;
  requireHierarchy?: boolean | undefined;
}

export interface ModelReadinessIssue extends VdtWarning {
  code: string;
}

export interface MissingModelInput {
  nodeId: string;
  nodeName: string;
  explicit: boolean;
  requiredForRoot: boolean;
}

export interface ModelReadinessResult {
  accepted: boolean;
  purpose: ModelReadinessPurpose;
  policyVersion: string;
  validation: ValidationResult;
  missingInputs: MissingModelInput[];
  issues: ModelReadinessIssue[];
  calculation?: GraphCalculationResult;
  hierarchy?: ReturnType<typeof inspectDecompositionHierarchy>;
  relationshipChecks?: Array<{ nodeId: string; result: DecompositionRelationshipVerification }>;
}

function graphIssue(issue: VdtWarning): ModelReadinessIssue {
  return { ...issue, code: issue.type.toUpperCase() };
}

function modelIssue(code: string, message: string, options: Partial<Pick<VdtWarning, "type" | "severity" | "nodeId">> = {}): ModelReadinessIssue {
  return { id: ["readiness", code, options.nodeId].filter(Boolean).join("-"), code, message, type: "invalid_graph", severity: "error", ...options };
}

/** Acceptance at a workspace boundary. Saved drafts can still use the existing draft/import rules. */
export function evaluateModelReadiness(project: VdtProject, options: ModelReadinessOptions): ModelReadinessResult {
  const { purpose, policyVersion = WORKSPACE_MODEL_READINESS_POLICY_VERSION, requireDerivedRoot, requireHierarchy } = options;
  const validation = validateGraph(project, undefined, { enforcePercentageScale: true, requireTimeInputUnits: requireDerivedRoot === true });
  const issues = [...validation.errors, ...validation.warnings].map(graphIssue);
  const { nodes } = project.graph;
  const rootId = project.rootNodeId;
  const root = nodes.find(node => node.id === rootId);
  const hierarchy = requireHierarchy ? inspectDecompositionHierarchy(project) : undefined;

  if (policyVersion !== WORKSPACE_MODEL_READINESS_POLICY_VERSION) {
    issues.push(modelIssue("UNSUPPORTED_POLICY_VERSION", `Unsupported model readiness policy "${policyVersion}".`));
  }
  if (hierarchy && !hierarchy.valid) {
    issues.push(modelIssue("HIERARCHY_INCOMPLETE", hierarchy.errors.join(" "), { nodeId: rootId }));
  }

  const references = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.formula?.trim()) continue;
    try {
      references.set(node.id, extractFormulaReferences(node.formula));
    } catch (error) {
      if (!(error instanceof FormulaParseError)) throw error;
      // Static validation already reports this formula.
    }
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  if (requireDerivedRoot && !references.get(rootId)?.some(id => id !== rootId && byId.has(id))) {
    issues.push(modelIssue("ROOT_NOT_DERIVED", "A new tree needs a root formula that references its driver nodes.", { nodeId: rootId }));
  }

  const required = new Set<string>();
  const pending = [rootId];
  while (pending.length) {
    const id = pending.pop()!;
    if (required.has(id)) continue;
    required.add(id);
    const goalSeek = byId.get(id)?.goalSeek;
    if (goalSeek) pending.push(goalSeek.targetNodeId);
    else for (const reference of references.get(id) ?? []) pending.push(reference);
  }

  const contextGroups = getDecompositionContextGroupIds(project.graph, rootId);
  const missingInputs: MissingModelInput[] = [];
  for (const node of nodes) {
    if (node.status === "rejected" || node.type === "calculated" || node.formula?.trim()
      || node.goalSeek || contextGroups.has(node.id)) continue;
    const value = readNodeBaselineValue(node);
    const explicit = node.valueStatus === "unknown" || node.status === "needs_data";
    if (value !== undefined) {
      if (!Number.isFinite(value)) {
        issues.push(modelIssue("INVALID_VALUE", `Value for ${node.name} must be a finite number.`, { nodeId: node.id, type: "invalid_value" }));
      }
      continue;
    }
    missingInputs.push({ nodeId: node.id, nodeName: node.name, explicit, requiredForRoot: required.has(node.id) });
    issues.push(modelIssue("INPUT_VALUE_MISSING", `Missing value for ${node.name}.`, {
      nodeId: node.id, type: "missing_value", severity: purpose === "structural_model" ? "info" : "error"
    }));
  }

  const relationshipChecks: NonNullable<ModelReadinessResult["relationshipChecks"]> = [];
  let typedRelationshipCount = 0;
  let measuredCalculation: GraphCalculationResult | undefined;
  for (const node of nodes) {
    if (node.status === "rejected") continue;
    const typedCount = (node.assumptions ?? []).filter(hasTypedDecompositionRelationship).length;
    if (typedCount === 0) continue;
    if (++typedRelationshipCount > relationshipLimit) {
      const issue = modelIssue("RELATIONSHIP_LIMIT", "The model exceeds the typed relationship verification limit.", { nodeId: node.id });
      validation.errors.push(issue);
      issues.push(issue);
      break;
    }
    const typed = readDecompositionAssumptions(node).filter(assumption => assumption.relationship);
    const relationship = typed[0]?.relationship;
    if (relationship && validation.valid) measuredCalculation ??= calculateGraph(project);
    const result: DecompositionRelationshipVerification = typedCount === 1 && relationship
      ? verifyDecompositionRelationship(node, relationship, byId, measuredCalculation?.values)
      : { status: "unverified", reason: "Record one valid, confirmed typed relationship for this KPI." };
    relationshipChecks.push({ nodeId: node.id, result });
    if (result.status === "passed") continue;
    const code = result.status === "mismatch" ? "RELATIONSHIP_FORMULA_MISMATCH" : "RELATIONSHIP_UNVERIFIED";
    const detail = result.status === "mismatch"
      ? `Inputs ${result.inputs.join(" and ")} require ${result.expected} ${relationship!.unit}, but the formula gives ${result.actual}.`
      : result.reason;
    const issue = modelIssue(code, `${node.name}: ${detail}`, { nodeId: node.id });
    validation.errors.push(issue);
    issues.push(issue);
  }
  if (typedRelationshipCount) validation.valid = validation.errors.length === 0;

  let calculation: GraphCalculationResult | undefined;
  const supported = policyVersion === WORKSPACE_MODEL_READINESS_POLICY_VERSION;
  if (purpose === "calculated_baseline" && supported && validation.valid) {
    calculation = measuredCalculation ?? calculateGraph(project);
    const reportedInputs = new Set(missingInputs.map(input => input.nodeId));
    for (const issue of [...calculation.errors, ...calculation.warnings]) {
      if (issue.type === "missing_value" && issue.nodeId && reportedInputs.has(issue.nodeId)) continue;
      issues.push(graphIssue(issue));
    }
    if (!Number.isFinite(calculation.rootValue)) {
      issues.push(modelIssue("ROOT_VALUE_NOT_FINITE", "Calculated root value is missing or non-finite.", { nodeId: root?.id, type: "invalid_value" }));
    }
  }

  return {
    accepted: !issues.some(issue => issue.severity === "error"),
    purpose, policyVersion, validation, missingInputs, issues,
    ...(hierarchy ? { hierarchy } : {}),
    ...(relationshipChecks.length ? { relationshipChecks } : {}),
    ...(calculation ? { calculation } : {})
  };
}
