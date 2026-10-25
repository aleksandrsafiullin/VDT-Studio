import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { buildKpiSuggestionContext, buildKpiSuggestionTaskInput, materializeKpiSuggestion, compileIncomingKpiBatch,
  incomingKpiProposalFormula, calculateGraph, kpiCanonicalJson, parseIncomingKpiUnit,
  SMART_KPI_INSTRUCTION, KPI_SUGGESTION_PREPARATION_VERSION } from "../packages/vdt-core/src/index.ts";
import { parseFormula } from "../packages/vdt-core/src/formula/parser.ts";
import { evaluateAst } from "../packages/vdt-core/src/formula/evaluator.ts";

// Test oracle only. These are the complete ore-only factors in the canonical
// skill, not a runtime topology selector. Numeric witnesses are synthetic.
// tuple: id, name, unit, parent, formula, value, accepted semantic aliases.
const rows = [
  ["ore_excavation", "Ore Excavation", "t", null, "active_excavator_count * net_excavation_time_per_excavator_h * ore_excavator_productivity_tph", 1_000_000],
  ["active_excavator_count", "Active excavator count", "excavator", "ore_excavation", null, 10, ["active_excavators", "number_of_active_excavators"]],
  ["net_excavation_time_per_excavator_h", "Net excavation time per excavator", "h/excavator", "ore_excavation", "calendar_time_per_excavator_h - downtime_per_excavator_h", 500, ["net_excavation_time", "net_time_per_excavator"]],
  ["ore_excavator_productivity_tph", "Ore excavator productivity", "t/h", "ore_excavation", "loaded_trucks_per_hour * tonnes_per_truck", 200, ["excavator_productivity", "ore_productivity"]],
  ["calendar_time_per_excavator_h", "Calendar time per excavator", "h/excavator", "net_excavation_time_per_excavator_h", "period_days * hours_per_day_24", 8760],
  ["period_days", "Period days", "d/excavator", "calendar_time_per_excavator_h", null, 365],
  ["hours_per_day_24", "Hours per day", "h/d", "calendar_time_per_excavator_h", null, 24],
  ["downtime_per_excavator_h", "Downtime per excavator", "h/excavator", "net_excavation_time_per_excavator_h", null, 8260],
  ["scheduled_non_excavation_time_h", "Scheduled non-excavation time", "h/excavator", "downtime_per_excavator_h", null, 826],
  ["technical_downtime_h", "Technical downtime", "h/excavator", "downtime_per_excavator_h", null, 826],
  ["technological_downtime_h", "Technological downtime", "h/excavator", "downtime_per_excavator_h", null, 826],
  ["organizational_downtime_h", "Organizational downtime", "h/excavator", "downtime_per_excavator_h", null, 826],
  ["relocation_or_move_time_h", "Relocation or move time", "h/excavator", "downtime_per_excavator_h", null, 826],
  ["material_or_face_not_ready_time_h", "Material or face not ready time", "h/excavator", "downtime_per_excavator_h", null, 826],
  ["drill_blast_waiting_or_restricted_access_time_h", "Drill/blast waiting or restricted access time", "h/excavator", "downtime_per_excavator_h", null, 826],
  ["operating_area_access_restriction_time_h", "Operating area access restriction time", "h/excavator", "downtime_per_excavator_h", null, 826],
  ["geotechnical_or_safety_restriction_time_h", "Geotechnical or safety restriction time", "h/excavator", "downtime_per_excavator_h", null, 826],
  ["other_downtime_h", "Other downtime", "h/excavator", "downtime_per_excavator_h", null, 826],
  ["loaded_trucks_per_hour", "Loaded trucks per hour", "truck/h", "ore_excavator_productivity_tph", "minutes_per_hour_60 / truck_loading_time_min", 10 / 3],
  ["minutes_per_hour_60", "Minutes per hour", "min/h", "loaded_trucks_per_hour", null, 60],
  ["truck_loading_time_min", "Truck loading time", "min/truck", "loaded_trucks_per_hour", "loading_movement_unloading_time_min + face_breakdown_ripping_time_min + truck_departure_arrival_time_min + relocation_time_min", 18],
  ["loading_movement_unloading_time_min", "Loading movement and unloading time", "min/truck", "truck_loading_time_min", null, 10],
  ["face_breakdown_ripping_time_min", "Face breakdown or ripping time", "min/truck", "truck_loading_time_min", null, 3, ["face_breakdown_ripping_time", "Face breakdown and ripping time"]],
  ["truck_departure_arrival_time_min", "Truck departure and arrival time", "min/truck", "truck_loading_time_min", null, 3],
  ["relocation_time_min", "Relocation time", "min/truck", "truck_loading_time_min", null, 2],
  ["tonnes_per_truck", "Tonnes per truck", "t/truck", "ore_excavator_productivity_tph", "buckets_per_truck * tonnes_per_bucket", 60, ["material_per_truck", "ore_material_per_truck", "ore_tonnes_per_truck", "payload_per_truck"]],
  ["buckets_per_truck", "Buckets per truck", "bucket/truck", "tonnes_per_truck", null, 4],
  ["tonnes_per_bucket", "Tonnes per bucket", "t/bucket", "tonnes_per_truck", "average_bucket_volume_m3 * ore_density_in_bucket_t_per_m3 * actual_bucket_fill_factor", 15, ["ore_tonnes_per_bucket"]],
  ["average_bucket_volume_m3", "Average bucket volume", "m3/bucket", "tonnes_per_bucket", null, 10],
  ["ore_density_in_bucket_t_per_m3", "Ore density in bucket", "t/m3", "tonnes_per_bucket", "ore_density_in_solid_t_per_m3 / swell_factor", 5 / 3],
  ["actual_bucket_fill_factor", "Actual bucket fill factor", "1", "tonnes_per_bucket", null, 0.9],
  ["ore_density_in_solid_t_per_m3", "Ore density in solid", "t/m3", "ore_density_in_bucket_t_per_m3", null, 2.5],
  ["swell_factor", "Swell factor", "1", "ore_density_in_bucket_t_per_m3", null, 1.5],
];
const byId = new Map(rows.map(([id, name, unit, parent, formula, value, aliases = []]) => [id, { id, name, unit, parent, formula, value, aliases }]));
const children = id => [...byId.values()].filter(row => row.parent === id);
byId.get("downtime_per_excavator_h").formula = children("downtime_per_excavator_h").map(row => row.id).join(" + ");
const depth = row => row.parent ? depth(byId.get(row.parent)) + 1 : 1;
const ordered = [...byId.values()].sort((a, b) => depth(a) - depth(b) || rows.findIndex(r => r[0] === a.id) - rows.findIndex(r => r[0] === b.id));
const stage = process.argv[2] ?? `full-${Date.now()}`;
if (!/^[a-zA-Z0-9_-]{1,70}$/.test(stage)) throw new Error("Use a safe unique stage name.");
// Optional recovery keeps the actual persisted graph after a harness/transport
// interruption. It never inserts oracle structure into the sequential tree.
const resumeIndex = process.argv.indexOf("--resume"), targetsIndex = process.argv.indexOf("--targets");
const resumeStage = resumeIndex < 0 ? undefined : process.argv[resumeIndex + 1];
if (resumeStage && !/^[a-zA-Z0-9_-]{1,70}$/.test(resumeStage)) throw new Error("Use a safe resume stage name.");
const requestedTargets = targetsIndex < 0 ? [] : process.argv[targetsIndex + 1].split(",");
if (requestedTargets.some(id => !byId.has(id))) throw new Error("Unknown reference target.");
const out = resolve("output/playwright/suggested-kpi-full-depth-20261025", stage); mkdirSync(out, { recursive: true });
const save = (name, value) => writeFileSync(resolve(out, name), typeof value === "string" ? value : JSON.stringify(value, null, 2));
const baseUrl = "http://127.0.0.1:3000", period = { key: "2026", grain: "year" };
const sourcePath = "packages/vdt-agent/skills/mining/excavation.md", source = readFileSync(sourcePath, "utf8");
// Only this explicitly requested QA scenario receives this domain reference.
// Production task construction imports no domain library or fixed skill.
const referenceSections = new Set(["Scope Boundary", "Readiness And Access Rule", "Canonical Decomposition", "Time Branch", "Productivity Branch", "Ore Productivity", "Optional Measurement Detail"]);
const projectReference = ["Project reference explicitly requested by the user: Ore Excavation from mining.excavation. These are this project's model definitions.",
  "Measurement basis of this QA project: active excavator count uses excavator (singular); all per-excavator period times use h/excavator; productivity t/h; loaded truck rate truck/h; truck payload t/truck; buckets per truck bucket/truck; bucket payload t/bucket; rated bucket capacity m3/bucket; both densities t/m3; fill and swell 1. Physical period days use d/excavator, fixed hours per day h/d, fixed minutes per hour min/h, per-truck component durations min/truck. Requested event measurements use event/excavator and h/event, or event/truck and min/event; repeat the same singular unit atom on both factors. This period scopes totals; it is not another divisor.",
  ...source.split(/(?=^## )/m).filter(section => referenceSections.has(section.split("\n", 1)[0].replace(/^## /, "").trim())).map(section => section.trim())].join("\n\n");
if (projectReference.length > 8000) throw new Error("The explicit QA project reference exceeds the project-context bound.");
save("project-reference.txt", projectReference);
save("oracle.json", ordered.map(row => ({ ...row, level: depth(row), expected: row.formula ? "canonical_layer" : "physical_definition_or_specific_empty", children: children(row.id).map(n => n.id) })));
save("instruction.txt", SMART_KPI_INSTRUCTION);
save("source.json", { sourcePath, sha256: createHash("sha256").update(source).digest("hex"), preparationVersion: KPI_SUGGESTION_PREPARATION_VERSION, node: process.version,
  referenceScope: "explicit_QA_project_businessContext_only", projectReferenceChars: projectReference.length });

const stamp = new Date().toISOString();
function baseProject() {
  return { id: "full_ore_excavation", name: "Ore Excavation — full-depth QA", industry: "Open-pit mining", businessContext: projectReference, rootNodeId: "ore_excavation", graph: { nodes: [], edges: [] }, dataSources: [],
    scenarios: [], versions: [], aiSettings: { defaultProviderId: "vdt_builder" }, createdAt: stamp, updatedAt: stamp };
}
const node = (row, target = false) => ({ id: row.id, name: row.name, unit: row.unit, type: target || !row.formula ? "input" : row.parent ? "calculated" : "root_kpi",
  status: "accepted", aiGenerated: false, createdAt: stamp, updatedAt: stamp, baselineValue: row.value,
  ...(row.formula && !target ? { formula: row.formula } : {}), ...(!row.parent ? { assumptions: ["Time period: Year"] } : {}) });
function isolatedProject(target) {
  const excluded = new Set(), queue = children(target).map(n => n.id);
  while (queue.length) { const id = queue.pop(); excluded.add(id); queue.push(...children(id).map(n => n.id)); }
  const project = baseProject(), keep = ordered.filter(row => !excluded.has(row.id));
  project.graph.nodes = keep.map(row => node(row, row.id === target));
  project.graph.edges = keep.filter(row => row.parent).map(row => ({ id: `edge_${row.id}`, sourceNodeId: row.parent, targetNodeId: row.id, relation: "formula_dependency", aiGenerated: false }));
  return project;
}
let project = baseProject(); project.graph.nodes = [node(byId.get("ore_excavation"), true)];
const actualIds = new Map([["ore_excavation", "ore_excavation"]]);
const normalize = text => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const equivalent = (child, row) => [row.id, row.name, ...row.aliases].some(text => [child.conceptKey, child.key, child.name].some(candidate => normalize(candidate) === normalize(text)));
let resumed;
if (resumeStage) {
  const previous = resolve("output/playwright/suggested-kpi-full-depth-20261025", resumeStage);
  resumed = JSON.parse(readFileSync(resolve(previous, "summary.json"), "utf8"));
  const previousSource = JSON.parse(readFileSync(resolve(previous, "source.json"), "utf8"));
  if (previousSource.sha256 !== createHash("sha256").update(source).digest("hex") || readFileSync(resolve(previous, "instruction.txt"), "utf8") !== SMART_KPI_INSTRUCTION)
    throw new Error("Resume requires the same frozen source and instruction.");
  project = JSON.parse(readFileSync(resolve(previous, "sequential-project.json"), "utf8"));
  for (const result of resumed.results.filter(row => row.committed)) {
    const expected = children(result.target);
    result.output.groups[0].children.forEach((child, i) => {
      const matched = expected.filter(row => equivalent(child, row));
      if (matched.length !== 1) throw new Error("Resolve a prior harness match before resuming.");
      actualIds.set(matched[0].id, result.compilation.aliases[i].nodeId);
    });
  }
  resumed.stored = JSON.parse(readFileSync(resolve(previous, "storage-head.json"), "utf8"));
  save("resume.json", { stage: resumeStage, owner: resumed.owner, vdtId: resumed.vdtId, requestedTargets });
}
const owner = resumed?.owner ?? `project_full_depth_${stage.replaceAll("-", "_")}`, vdtId = resumed?.vdtId ?? `vdt_full_depth_${stage.replaceAll("-", "_")}`;
async function http(path, body) {
  const response = await fetch(baseUrl + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw Object.assign(new Error(JSON.stringify(payload)), { httpStatus: response.status, payload });
  return payload;
}
const runtimeCas = state => ({ schemaVersion: "project_runtime_cas.v1", runtimeGeneration: state.runtimeGeneration, generationVersion: state.generationVersion });
const admission = await http("/api/ai/suggestions/execution", { backendId: "codex_subscription", model: "gpt-5.6-luna", timeoutMs: 5000 });
const { backendId, modelId, bindingVersion, credentialEpoch } = admission.identity;
const execution = { mode: "cli", backendId, modelId, bindingVersion, credentialEpoch };
save("execution.json", admission);
let stored = resumed?.stored;
if (!stored) {
  const created = await http("/api/vdt/projects", { id: owner, name: `QA · Ore Excavation · all levels · ${stage}`, description: "Synthetic all-level Suggested KPI audit. Failed branches are retained and never replaced by manual oracle factors." });
  stored = await http(`/api/vdt/projects/${owner}/vdts`, { schemaVersion: "create_vdt_with_initial_http_request.v1", idempotencyKey: `initial_${stage}`,
    expectedRuntime: runtimeCas(created.summary.runtimeState), vdt: { requestedVdtId: vdtId, name: "Ore Excavation — full-depth Suggested audit", rootKpi: "Ore Excavation", unit: "t", timePeriod: "Year", status: "draft", metadata: { synthetic: true } }, project });
}
let head = stored.head, runtimeState = stored.runtimeState;
const sameNumber = (a, b) => Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
const unit = text => text.replaceAll("m³", "m3").replaceAll(" ", "");
const results = [];
for (const row of ordered) {
  if (requestedTargets.length && !requestedTargets.includes(row.id)) continue;
  const inTree = actualIds.has(row.id), current = inTree ? project : isolatedProject(row.id), targetId = inTree ? actualIds.get(row.id) : row.id;
  const context = await buildKpiSuggestionContext(current, { workspaceId: `${owner}_${row.id}`.slice(0, 160), vdtId: inTree ? vdtId : null, targetNodeId: targetId, period });
  const input = buildKpiSuggestionTaskInput(context), result = { target: row.id, level: depth(row), expected: row.formula ? "canonical_layer" : "physical_definition_or_specific_empty", mode: inTree ? "sequential_tree" : "isolated_beyond_blocker", actualTargetId: targetId };
  save(`${row.id}.input.json`, input);
  const started = Date.now();
  try {
    const payload = await http("/api/ai/suggestions", { input, providerId: "local_runner", providerConfig: { backendId, model: admission.identity.requestModel }, timeoutMs: 30000, requestId: crypto.randomUUID() });
    result.elapsedMs = Date.now() - started; result.output = payload.result; result.observed = payload.result.status;
    if (result.observed === "empty") result.verdict = row.formula ? "missing_decomposition" : "empty_requires_semantic_review";
    else if (!row.formula) {
      const proposal = materializeKpiSuggestion(payload.result, context, { proposalId: crypto.randomUUID(), requestId: crypto.randomUUID(), now: new Date().toISOString(), execution });
      result.verdict = "extension_requires_semantic_review";
      result.formalValidation = { materialization: "passed", alternatives: proposal.groups.length };
      // Numerical witnesses are illustrative and local-only. They verify the
      // actual compiler without claiming semantic or physical plausibility.
      const previews = [];
      for (const group of proposal.groups) {
        const batch = { schemaVersion: "incoming_kpi_apply.v2", context, proposal, draft: { schemaVersion: "incoming_kpi_draft.v2", targetNodeId: targetId,
          contextHash: context.contextHash, revision: 0, source: { kind: "proposal", proposalId: proposal.proposalId, groupId: group.id }, childKeys: group.children.map(child => child.key),
          manualChildren: [], existingFactors: [], formula: incomingKpiProposalFormula(proposal, group.id), formulaAuthorship: group.recipeBinding ? "recipe" : "model",
          estimateMissingValues: true } };
        try {
          const compiled = await compileIncomingKpiBatch(current, batch, { operationId: `smart_probe_${crypto.randomUUID().replaceAll("-", "")}`, now: new Date().toISOString() });
          previews.push({ groupId: group.id, compiler: "passed", rootBefore: calculateGraph(current).rootValue, rootAfter: calculateGraph(compiled.preview).rootValue,
            witnessKind: "illustrative_local_only", inputs: compiled.values.inputs });
          save(`${row.id}.${group.id}.preview.json`, compiled.preview);
        } catch (error) { previews.push({ groupId: group.id, compiler: "failed", code: error.code, message: error.message }); }
      }
      result.extensionPreviews = previews;
    }
    else {
      const proposal = materializeKpiSuggestion(payload.result, context, { proposalId: crypto.randomUUID(), requestId: crypto.randomUUID(), now: new Date().toISOString(), execution });
      const group = proposal.groups[0], expected = children(row.id), matched = group.children.map(child => expected.filter(candidate => equivalent(child, candidate)));
      if (group.children.length !== expected.length || matched.some(list => list.length !== 1) || new Set(matched.flat().map(n => n.id)).size !== expected.length)
        result.verdict = "factor_mismatch";
      else {
        const mapped = matched.map(list => list[0]), aliases = new Map(group.children.map((child, index) => [child.key, mapped[index]]));
        const actualAst = parseFormula(group.formula), expectedAst = parseFormula(row.formula);
        const signatureMatches = [1, 2, 3].every(sample => {
          const values = new Map(expected.map((child, i) => [child.id, sample * 1.31 + (i + 1) * 2.17]));
          return sameNumber(evaluateAst(actualAst, key => values.get(aliases.get(key)?.id)), evaluateAst(expectedAst, id => values.get(id)));
        });
        const unitsMatch = group.children.every((child, i) => kpiCanonicalJson(parseIncomingKpiUnit(unit(child.unit), period)) === kpiCanonicalJson(parseIncomingKpiUnit(mapped[i].unit, period)));
        if (!signatureMatches || !unitsMatch) result.verdict = !signatureMatches ? "formula_mismatch" : "basis_mismatch";
        else {
          const batch = { schemaVersion: "incoming_kpi_apply.v2", context, proposal, draft: { schemaVersion: "incoming_kpi_draft.v2", targetNodeId: targetId,
            contextHash: context.contextHash, revision: 0, source: { kind: "proposal", proposalId: proposal.proposalId, groupId: group.id }, childKeys: group.children.map(child => child.key),
            manualChildren: [], existingFactors: [], formula: incomingKpiProposalFormula(proposal, group.id), formulaAuthorship: group.recipeBinding ? "recipe" : "model",
            inputValues: Object.fromEntries(group.children.map((child, i) => [`p_${i + 1}`, String(mapped[i].value)])), estimateMissingValues: false } };
          const compiled = await compileIncomingKpiBatch(current, batch, { operationId: `smart_full_${crypto.randomUUID().replaceAll("-", "")}`, now: new Date().toISOString() });
          result.verdict = "decomposition_confirmed"; result.compilation = { rootBefore: calculateGraph(current).rootValue, rootAfter: calculateGraph(compiled.preview).rootValue, aliases: compiled.aliases };
          if (inTree) {
            const committed = await http(`/api/vdt/vdts/${vdtId}/revisions`, { schemaVersion: "manual_vdt_revision_commit_request.v1", idempotencyKey: `full_${crypto.randomUUID()}`,
              expectedHead: { schemaVersion: "vdt_revision_cas.v1", activeRevisionId: head.activeRevisionId, activeContentIdentity: head.activeContentIdentity, commitGeneration: head.commitGeneration },
              expectedRuntime: runtimeCas(runtimeState), summary: `QA Suggested layer: ${row.name}`, project: compiled.preview });
            project = compiled.preview; head = committed.head; runtimeState = committed.runtimeState;
            group.children.forEach((child, i) => actualIds.set(mapped[i].id, compiled.aliases[i].nodeId));
            result.committed = true; save("sequential-project.json", project); save("storage-head.json", committed);
          }
        }
      }
    }
  } catch (error) { result.verdict = "execution_or_validation_failure"; result.error = { message: error.message, code: error.code, payload: error.payload }; }
  results.push(result); save(`${row.id}.result.json`, result);
  console.log(JSON.stringify({ target: row.id, level: result.level, mode: result.mode, expected: result.expected, observed: result.observed, verdict: result.verdict, committed: result.committed, reason: result.output?.rationale, error: result.error?.code ?? result.error?.message }));
  save("summary.json", { owner, vdtId, url: `http://localhost:3000/projects/${owner}?vdt=${vdtId}`, totalReferenceNodes: ordered.length, referenceLevels: Math.max(...ordered.map(depth)), actualNodeCount: project.graph.nodes.length,
    actualMappedReferenceIds: [...actualIds.keys()], calculation: calculateGraph(project), results });
}
console.log(JSON.stringify({ completeAudit: true, total: results.length, actualNodes: project.graph.nodes.length, verdicts: Object.fromEntries([...new Set(results.map(r => r.verdict))].map(verdict => [verdict, results.filter(r => r.verdict === verdict).length])) }));
