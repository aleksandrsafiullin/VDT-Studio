import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { buildKpiSuggestionContext, buildKpiSuggestionTaskInput, materializeKpiSuggestion, compileIncomingKpiBatch,
  incomingKpiProposalFormula, SMART_KPI_INSTRUCTION, KPI_SUGGESTION_PREPARATION_VERSION } from "../packages/vdt-core/src/index.ts";
import { createIncomingGraphFixture } from "../packages/vdt-core/src/suggestions/incoming-contract.fixtures.ts";

// Live domain-neutral controls. Definitions belong only to each test project;
// no library selection or domain reference is injected into the shared task.
const stage = process.argv[2] ?? `domains-${Date.now()}`;
const requested = new Set(process.argv.slice(3));
if (!/^[a-zA-Z0-9_-]{1,70}$/.test(stage)) throw new Error("Use a safe stage name.");
const out = resolve("output/playwright/suggested-kpi-full-depth-20261025", stage); mkdirSync(out, { recursive: true });
const save = (name, value) => writeFileSync(resolve(out, name), typeof value === "string" ? value : JSON.stringify(value, null, 2));
const stamp = new Date().toISOString(), period = { key: "2026", grain: "year" };
const project = (id, name, unit, industry, businessContext, value) => ({ id, name, industry, businessContext, rootNodeId: "target", graph: {
  nodes: [{ id: "target", name, unit, type: "input", status: "accepted", baselineValue: value, aiGenerated: false, createdAt: stamp, updatedAt: stamp }], edges: [] },
  dataSources: [], scenarios: [], versions: [], aiSettings: { defaultProviderId: "vdt_builder" }, createdAt: stamp, updatedAt: stamp });
const cases = [
  { id: "construction", target: "target", project: project("construction_qa", "Installed facade area", "m^2", "Construction",
    "Installed facade area is installed panel count multiplied by mean net area per installed panel. Units: count and m^2/count. Net panel area already excludes openings. Preserve this direct area definition.", 1000) },
  { id: "manufacturing", target: "target", project: project("manufacturing_qa", "Good units produced", "count", "Manufacturing",
    "Good units produced equals net machine run time (h) multiplied by gross production rate (count/h) multiplied by conforming fraction (1). All refer to the same line and annual period. Preserve these three immediate factors.", 9000) },
  { id: "gross_revenue", target: "target", project: project("revenue_qa", "Gross product revenue", "USD", "Product sales",
    "Gross product revenue equals units sold (count) multiplied by average gross unit price (USD/count). This is gross revenue before discounts, returns and refunds; those deductions do not belong in this KPI's formula.", 20000) },
  { id: "inverse_identity", target: "target", project: createIncomingGraphFixture("shared_speed") }
];
save("instruction.txt", SMART_KPI_INSTRUCTION);
save("source.json", { preparationVersion: KPI_SUGGESTION_PREPARATION_VERSION, node: process.version,
  instructionSha256: createHash("sha256").update(SMART_KPI_INSTRUCTION).digest("hex") });
async function post(path, body) {
  const response = await fetch(`http://127.0.0.1:3000${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw Object.assign(new Error(JSON.stringify(payload)), { payload });
  return payload;
}
const admission = await post("/api/ai/suggestions/execution", { backendId: "codex_subscription", model: "gpt-5.6-luna", timeoutMs: 5000 });
const { backendId, modelId, bindingVersion, credentialEpoch } = admission.identity;
const execution = { mode: "cli", backendId, modelId, bindingVersion, credentialEpoch };
save("execution.json", admission);
const results = [];
for (const item of cases) {
  if (requested.size && !requested.has(item.id)) continue;
  const context = await buildKpiSuggestionContext(item.project, { workspaceId: `domain_qa_${stage}_${item.id}`, vdtId: null, targetNodeId: item.target, period });
  const input = buildKpiSuggestionTaskInput(context), result = { id: item.id, expected: item.id === "inverse_identity" ? "independent_measurement_or_specific_empty" : "project_definition" };
  if (JSON.stringify(input).match(/mining\.excavation|excavator|bucket/i)) throw new Error("A cross-domain request contains excavation reference text.");
  save(`${item.id}.input.json`, input);
  const started = Date.now();
  try {
    const payload = await post("/api/ai/suggestions", { input, providerId: "local_runner", providerConfig: { backendId, model: admission.identity.requestModel }, timeoutMs: 30000, requestId: crypto.randomUUID() });
    result.elapsedMs = Date.now() - started; result.output = payload.result;
    const proposal = materializeKpiSuggestion(payload.result, context, { proposalId: crypto.randomUUID(), requestId: crypto.randomUUID(), now: new Date().toISOString(), execution });
    result.materialization = "passed";
    if (proposal) {
      const group = proposal.groups[0], batch = { schemaVersion: "incoming_kpi_apply.v2", context, proposal, draft: { schemaVersion: "incoming_kpi_draft.v2", targetNodeId: item.target,
        contextHash: context.contextHash, revision: 0, source: { kind: "proposal", proposalId: proposal.proposalId, groupId: group.id }, childKeys: group.children.map(child => child.key),
        manualChildren: [], existingFactors: [], formula: incomingKpiProposalFormula(proposal, group.id), formulaAuthorship: group.recipeBinding ? "recipe" : "model", estimateMissingValues: true } };
      const compiled = await compileIncomingKpiBatch(item.project, batch, { operationId: `smart_domain_${crypto.randomUUID().replaceAll("-", "")}`, now: new Date().toISOString() });
      result.compiler = "passed"; result.witness = { kind: "illustrative_local_only", inputs: compiled.values.inputs, result: compiled.values.result };
    }
  } catch (error) { result.error = { code: error.code, message: error.message, payload: error.payload }; }
  results.push(result); save(`${item.id}.result.json`, result); save("summary.json", results);
  console.log(JSON.stringify({ id: item.id, status: result.output?.status, materialization: result.materialization, compiler: result.compiler, error: result.error,
    formula: result.output?.groups[0]?.formula, rationale: result.output?.rationale }));
}
