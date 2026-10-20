import { createSmartKpiMeasuredFixture, SMART_KPI_FIXTURE_TIME as now } from "./fixtures";
import { buildKpiSuggestionContext } from "./identity";
import { KPI_SUGGESTION_RECIPES } from "./recipes";
import { INCOMING_KPI_APPLY_SCHEMA, INCOMING_KPI_DRAFT_SCHEMA, type IncomingKpiBatchInput } from "./incoming-types";
import { KPI_SUGGESTION_SCHEMA, KPI_SUGGESTION_VALIDATOR, type KpiSuggestionContext, type KpiSuggestionSet } from "./types";
import type { VdtNode, VdtProject } from "../types";

export const manualKey = `m_${"1".repeat(32)}` as const;
export const existingKey = (index: number) => `e_${index.toString(16).padStart(32, "0")}` as const;
export const fixtureExecution = { mode: "api" as const, backendId: "openai_compatible", modelId: "gpt-6-luna", bindingVersion: "contract_fixture", credentialEpoch: "contract_fixture" };
const node = (id: string, unit: string, extra: Partial<VdtNode> = {}): VdtNode => ({ id, name: id, unit, type: "input", status: "accepted", aiGenerated: false, createdAt: now, updatedAt: now, ...extra });

/** Synthetic projects exercise the observed haulage dependency shapes. No live
 * values/rows/credentials are copied; source values are explicit QA witnesses. */
export function createIncomingGraphFixture(kind: "measured" | "shared_speed" | "off_root" | "existing_six"): VdtProject {
  const project = createSmartKpiMeasuredFixture(4);
  project.id = `incoming_contract_${kind}`; project.rootNodeId = "output";
  const target = node("target", "km/trip", { baselineValue: 4, valueSource: { sourceTier: "file", note: "Fictitious reference source4." },
    dataMapping: { sourceId: "fixture_source", field: "distance", aggregation: "avg", unit: "km/trip" } });
  project.graph = { nodes: [node("output", "km/trip", { type: "root_kpi", formula: "target" }), target],
    edges: [{ id: "edge_output_target", sourceNodeId: "output", targetNodeId: "target", relation: "formula_dependency", aiGenerated: false }] };
  project.scenarios = [];
  if (kind === "measured") {
    project.graph.nodes.push(node("old_context", "%", { type: "external_factor" }));
    project.graph.edges.push({ id: "edge_old_context", sourceNodeId: "target", targetNodeId: "old_context", relation: "contextual_influence", aiGenerated: false });
    project.graph.nodes[0]!.decompositionPlan = { version: 1, goal: "Measured input with an old explanatory child.", nodes: [
      { nodeId: "target", parentNodeId: "output", kind: "input" }, { nodeId: "old_context", parentNodeId: "target", kind: "context", rationale: "Retained context only." }] };
  }
  if (kind === "shared_speed") {
    target.name = "Фактическая гружёная скорость, порода"; target.unit = "km/h"; target.baselineValue = 14;
    target.dataMapping!.unit = "km/h";
    project.graph.nodes[0]!.name = "Гружёное движение, порода"; project.graph.nodes[0]!.unit = "h/trip"; project.graph.nodes[0]!.formula = "distance / target";
    project.graph.nodes.push(node("distance", "km/trip", { name: "Среднее гружёное расстояние на рейс, порода", baselineValue: 4 }));
    project.graph.edges.push({ id: "edge_output_distance", sourceNodeId: "output", targetNodeId: "distance", relation: "formula_dependency", aiGenerated: false });
    project.graph.nodes[0]!.decompositionPlan = { version: 1, goal: "Independent measured distance and speed define moving time.", nodes: [
      { nodeId: "target", parentNodeId: "output", kind: "input" }, { nodeId: "distance", parentNodeId: "output", kind: "input" }] };
  }
  if (kind === "off_root") {
    project.graph.nodes[0]!.formula = "active"; project.graph.nodes.push(node("active", "km/trip", { baselineValue: 4 }));
    project.graph.edges[0]!.relation = "contextual_influence";
    project.graph.edges.push({ id: "edge_output_active", sourceNodeId: "output", targetNodeId: "active", relation: "formula_dependency", aiGenerated: false });
    project.graph.nodes[0]!.decompositionPlan = { version: 1, goal: "Separate off-root reference model.", nodes: [
      { nodeId: "target", parentNodeId: "output", kind: "context", rationale: "Reference branch." }, { nodeId: "active", parentNodeId: "output", kind: "input" }] };
  }
  if (kind === "existing_six") {
    target.type = "calculated"; target.formula = Array.from({ length: 6 }, (_, i) => `factor_${i}`).join(" + ");
    for (let i = 0; i < 6; i++) {
      project.graph.nodes.push(node(`factor_${i}`, "km/trip", { baselineValue: 1 }));
      project.graph.edges.push({ id: `edge_factor_${i}`, sourceNodeId: "target", targetNodeId: `factor_${i}`, relation: "formula_dependency", aiGenerated: false });
    }
  }
  return project;
}
export const fixtureContext = (project: VdtProject) => buildKpiSuggestionContext(project, { targetNodeId: "target", workspaceId: "contract_workspace", vdtId: null, period: { key: "explicit:2026-10-05–2026-10-11", grain: "custom" } });
export function manualInput(context: KpiSuggestionContext): IncomingKpiBatchInput {
  return { schemaVersion: INCOMING_KPI_APPLY_SCHEMA, context, draft: { schemaVersion: INCOMING_KPI_DRAFT_SCHEMA, targetNodeId: context.targetNodeId,
    contextHash: context.contextHash, revision: 0, source: { kind: "manual" }, childKeys: [],
    manualChildren: [{ key: manualKey, name: "Own distance metric", unit: "km/trip", selected: true }], existingFactors: [], formula: manualKey, formulaAuthorship: "user" } };
}
export function modelProposal(context: KpiSuggestionContext): KpiSuggestionSet {
  return { schemaVersion: KPI_SUGGESTION_SCHEMA, validatorVersion: KPI_SUGGESTION_VALIDATOR, catalogVersion: KPI_SUGGESTION_RECIPES.version,
    proposalId: "contract_model_proposal", targetNodeId: context.targetNodeId, contextHash: context.contextHash, createdAt: now, expiresAt: "2026-10-20T00:00:00.000Z",
    origin: { kind: "model", requestId: "contract_request", execution: fixtureExecution }, rationale: "Proposed measured components.", limitations: [],
    groups: [{ id: "components", title: "Measured components", selectionMode: "all", requiredKeys: ["first", "second"], formula: "first + second", limitations: [], children: [
      { key: "first", conceptKey: "first_component", name: "First component", unit: context.target.unit! },
      { key: "second", conceptKey: "second_component", name: "Second component", unit: context.target.unit! }] }] };
}
