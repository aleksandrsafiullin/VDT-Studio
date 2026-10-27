#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateGraph, validateGraph, inspectDecompositionHierarchy, getDecompositionContextGroupIds } from "../packages/vdt-core/src/index.ts";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT), "..");
export const REQUESTS_PATH = resolve(ROOT, "eval/agent-autonomy/requests.v1.json");
export const ORACLES_PATH = resolve(ROOT, "eval/agent-autonomy/oracles.v1.json");
export const REVIEW_DIMENSIONS = ["scope", "relationships", "units", "provenance", "clarifications", "guidance", "finalReport"];
const OUTCOMES = new Set(["completion", "clarification", "clarification_or_labelled_estimate"]);
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => typeof v === "string" && v.trim().length > 0;
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const near = (a, b) => finite(a) && finite(b) && Math.abs(a - b) <= Math.max(1, Math.abs(b)) * 1e-8;
const fail = (message) => { throw new Error(`Agent evaluation: ${message}`); };
const exactKeys = (v, allowed, where) => {
  if (!record(v) || Object.keys(v).some((k) => !allowed.includes(k))) fail(`${where} contains unsupported fields.`);
};

export function validatePublicCase(entry) {
  exactKeys(entry, ["id", "userRequest", "setup", "assets"], "public case");
  if (!text(entry.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id) || !text(entry.userRequest)) fail("A case needs an ID and a business request.");
  exactKeys(entry.setup, ["rootKpi", "unit", "timePeriod", "businessContext", "goal"], "public setup");
  if (!text(entry.setup.rootKpi) || Object.values(entry.setup).some((value) => !text(value))) fail("Setup fields must contain user-visible business context.");
  if (entry.assets !== undefined && (!Array.isArray(entry.assets) || entry.assets.some((p) => !text(p) || !p.startsWith("assets/") || p.split("/").includes("..")))) fail("Assets must name suite-local business data files.");
}

/** Only normal user text and visible setup can reach generation. No oracle is
 * loaded by this function or by loadPublicCases. Attach listed data via the UI. */
export function agentInputForCase(entry) {
  validatePublicCase(entry);
  return { prompt: entry.userRequest, rootKpi: entry.setup.rootKpi,
    ...Object.fromEntries(["unit", "timePeriod", "businessContext", "goal"].filter((key) => entry.setup[key] !== undefined).map((key) => [key, entry.setup[key]])) };
}

export function publicInputHash(entry) {
  return `sha256:${createHash("sha256").update(JSON.stringify(agentInputForCase(entry))).digest("hex")}`;
}

export function privateOracleHash(oracle) {
  return `sha256:${createHash("sha256").update(JSON.stringify(oracle)).digest("hex")}`;
}

export async function loadPublicCases(path = REQUESTS_PATH) {
  const suite = JSON.parse(await readFile(path, "utf8"));
  if (suite.schemaVersion !== 1 || suite.evaluationClass !== "business_autonomy" || !Array.isArray(suite.cases) || !suite.cases.length) fail("Unsupported public request suite.");
  const ids = new Set();
  for (const entry of suite.cases) {
    validatePublicCase(entry);
    if (ids.has(entry.id)) fail("Duplicate public case ID.");
    ids.add(entry.id);
  }
  return suite;
}

export async function loadOracles(path = ORACLES_PATH) {
  const suite = JSON.parse(await readFile(path, "utf8"));
  if (suite.schemaVersion !== 1 || suite.visibility !== "evaluator_only" || !Array.isArray(suite.cases)) fail("Unsupported private oracle suite.");
  const ids = new Set();
  for (const oracle of suite.cases) {
    if (!text(oracle.id) || ids.has(oracle.id) || !OUTCOMES.has(oracle.outcome) || !record(oracle.roles) || !Array.isArray(oracle.probes)
      || !Array.isArray(oracle.rubric) || !oracle.rubric.length || oracle.rubric.some((line) => !text(line))) fail("Invalid or duplicate private oracle.");
    ids.add(oracle.id);
    if (oracle.expectedRootValue !== undefined && !finite(oracle.expectedRootValue)) fail("Expected root values must be finite.");
    for (const role of Object.values(oracle.roles)) if (!Array.isArray(role.expectedValues) || !role.expectedValues.length || !role.expectedValues.every(finite)) fail("Invalid role values.");
    for (const probe of oracle.probes) if (!(probe.role in oracle.roles) || !finite(probe.value) || !finite(probe.expectedRootValue)) fail("Invalid sensitivity probe.");
    if (oracle.reviewNotApplicable?.some((dimension) => !REVIEW_DIMENSIONS.includes(dimension))) fail("Unknown review dimension.");
  }
  return suite;
}

function dependencyClosure(project) {
  // Calculation traces identify actual referenced inputs; numerical probes also
  // reject a fake constant root padded with unused or zero-weight dependencies.
  const result = calculateGraph(project);
  const byId = new Map(result.trace.map((item) => [item.nodeId, item]));
  const seen = new Set();
  const pending = [project.rootNodeId];
  while (pending.length) {
    const id = pending.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const input of byId.get(id)?.inputs ?? []) pending.push(input.nodeId);
  }
  return seen;
}

/** Offline evaluator only. Never calls a provider, repairs a graph, supplies a
 * user answer, or forwards role mappings/rubrics/expected results to generation. */
export function assessAgentCase(entry, oracle, evidence) {
  validatePublicCase(entry);
  if (oracle.id !== entry.id) fail("Oracle/case identity mismatch.");
  if (!record(evidence)) fail("Evidence must be a captured JSON object.");
  const snapshot = record(evidence.snapshot) ? evidence.snapshot : {};
  const capture = record(evidence.capture) ? evidence.capture : {};
  const input = snapshot.request?.input ?? {};
  const expectedInput = agentInputForCase(entry);
  const execution = snapshot.executionSummary ?? {};
  const checks = {};
  const add = (name, ok) => { checks[name] = ok === true; };
  add("liveEvidence", capture.origin === "live_app" && !["mock", "fixture", "test"].includes(execution.backendId));
  add("businessRequestClass", capture.requestClass === "business_autonomy");
  add("frozenOracle", capture.oracleHash === privateOracleHash(oracle));
  const frozenAt = Date.parse(capture.oracleFrozenAt);
  const startedAt = Date.parse(snapshot.createdAt);
  add("oracleFrozenBeforeRun", finite(frozenAt) && finite(startedAt) && frozenAt <= startedAt);
  add("executionIdentified", text(execution.backendId) && text(execution.modelId) && text(snapshot.request?.executionBindingId));
  add("freshSession", capture.freshSession === true);
  add("originalBusinessRequest", input.prompt === entry.userRequest);
  add("visibleSetupMatches", Object.entries(expectedInput).filter(([key]) => key !== "prompt").every(([key, value]) => input[key] === value));
  add("noAdditionalUserChannelHints", ["businessContext", "goal"].every((field) => !text(input[field]) || input[field] === entry.userRequest || input[field] === entry.setup[field]));
  add("noOperatorRescue", Array.isArray(capture.interventions) && capture.interventions.every((item) => item?.kind === "business_fact"));
  const initial = input.project ?? evidence.startingProject;
  const initialRoot = initial?.graph?.nodes?.find((node) => node.id === initial.rootNodeId);
  add("blankStartingTree", initial?.graph?.nodes?.length === 1 && initialRoot && !initialRoot.formula?.trim()
    && initialRoot.baselineValue === undefined && initialRoot.value === undefined);
  const eligibilityChecks = Object.keys(checks);
  const pendingEvidence = [];
  const evidenceIssues = [];
  const events = Array.isArray(snapshot.events) ? snapshot.events.filter(record) : [];
  const receipt = events.find((event) => event.type === "run_completed" && text(event.metadata?.finishReceiptId))?.metadata.finishReceiptId;
  const asking = snapshot.status === "needs_user_input" && Array.isArray(snapshot.pendingQuestions) && snapshot.pendingQuestions.length > 0;
  const completing = snapshot.status === "succeeded" && text(receipt) && execution.finishState === "final_persisted";
  add("noFalseCompletionDuringQuestion", !asking || !text(receipt) && execution.finishState !== "final_persisted");
  add("appropriateEndpoint", oracle.outcome === "completion" ? completing : oracle.outcome === "clarification" ? asking : asking || completing);
  let calculation;
  let graphDiagnostics;
  let missingUnitNodeIds = [];
  const probes = [];
  if (completing) {
    const project = evidence.persistedProject;
    if (!record(project) || !record(project.graph)) pendingEvidence.push("persistedProject");
    if (record(project) && record(project.graph)) {
      try {
        const validation = validateGraph(project);
        const hierarchy = inspectDecompositionHierarchy(project);
        calculation = calculateGraph(project);
        graphDiagnostics = { valid: validation.valid, hierarchyValid: hierarchy.valid, calculationErrors: calculation.errors.length };
        add("validGraph", validation.valid);
        add("validHierarchy", hierarchy.valid);
        add("calculable", calculation.errors.length === 0 && finite(calculation.rootValue));
        const contextGroups = getDecompositionContextGroupIds(project.graph, project.rootNodeId);
        missingUnitNodeIds = project.graph.nodes.filter((node) => !contextGroups.has(node.id)
          && (finite(node.baselineValue ?? node.value) || text(node.formula))
          && (!text(node.unit) || ["n/a", "unit n/a", "unknown", "—"].includes(node.unit.trim().toLowerCase()))).map((node) => node.id);
        add("numericUnitFieldsPresent", missingUnitNodeIds.length === 0);
        if (oracle.expectedRootValue !== undefined) add("businessResult", near(calculation.rootValue, oracle.expectedRootValue));
        const closure = dependencyClosure(project);
        const ids = new Set(project.graph.nodes.map((node) => node.id));
        const boundIds = new Set();
        const bindings = {};
        for (const [role, specification] of Object.entries(oracle.roles)) {
          const binding = evidence.roleBindings?.[role];
          if (binding === undefined) { pendingEvidence.push(`roleBinding:${role}`); continue; }
          const nodeId = typeof binding === "string" ? binding : binding?.nodeId;
          const scale = typeof binding === "string" ? 1 : binding?.scale ?? 1;
          const valid = ids.has(nodeId) && nodeId !== project.rootNodeId && !boundIds.has(nodeId) && finite(scale) && scale > 0;
          if (!valid) evidenceIssues.push(`invalidRoleBinding:${role}`);
          add(`roleBinding:${role}`, valid && closure.has(nodeId));
          if (!valid) continue;
          boundIds.add(nodeId);
          bindings[role] = { nodeId, scale };
          add(`sourceValue:${role}`, specification.expectedValues.some((value) => near(calculation.values[nodeId] * scale, value)));
        }
        for (const probe of oracle.probes) {
          const binding = bindings[probe.role];
          if (evidence.roleBindings?.[probe.role] === undefined) { probes.push({ role: probe.role, changedValue: probe.value, ok: null, reason: "reviewer_role_mapping_pending" }); continue; }
          const result = binding ? calculateGraph(project, { overrides: { [binding.nodeId]: probe.value / binding.scale } }) : undefined;
          const ok = !!result && result.errors.length === 0 && near(result.rootValue, probe.expectedRootValue);
          add(`sensitivity:${probe.role}:${probe.value}`, ok);
          probes.push({ role: probe.role, changedValue: probe.value, expectedRootValue: probe.expectedRootValue, actualRootValue: result?.rootValue ?? null, ok });
        }
      } catch (error) {
        add("projectAuditSucceeded", false);
        graphDiagnostics = { error: error instanceof Error ? error.message : "Invalid project." };
      }
    }
  }
  const review = evidence.semanticReview;
  const independentReview = record(review) && text(review.reviewer) && review.independentOfGenerator === true;
  const reviewResults = REVIEW_DIMENSIONS.map((dimension) => {
    const finding = review?.checks?.[dimension];
    const supported = Array.isArray(finding?.evidenceReferences) && finding.evidenceReferences.some(text);
    const approved = finding?.verdict === "pass" || finding?.verdict === "not_applicable" && oracle.reviewNotApplicable?.includes(dimension);
    return { dimension, verdict: finding?.verdict ?? "pending", supported, approved: !!independentReview && !!supported && !!approved };
  });
  const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  const failedEligibility = eligibilityChecks.filter((name) => !checks[name]);
  const failedReview = reviewResults.some((finding) => finding.verdict === "fail" && finding.supported && independentReview);
  const decision = failedEligibility.length ? "ineligible_evidence" : evidenceIssues.length ? "invalid_evidence" : failedChecks.length || failedReview ? "failed_case"
    : !pendingEvidence.length && reviewResults.every((finding) => finding.approved) ? "accepted_case_only" : "needs_review";
  return { schemaVersion: 1, evaluationClass: "business_autonomy", caseId: entry.id, publicInputHash: publicInputHash(entry), oracleHash: privateOracleHash(oracle),
    decision, supportsGeneralAutonomyClaim: false, providerCertificationChanged: false,
    observation: { runId: snapshot.runId ?? null, status: snapshot.status ?? null, backendId: execution.backendId ?? null, modelId: execution.modelId ?? null,
      finishReceiptId: receipt ?? null, calculatedRootValue: calculation?.rootValue ?? null,
      publishedQuestionCount: events.filter((event) => event.type === "clarifying_questions").length,
      recordedInterventions: capture.interventions?.map((item) => item.kind) ?? null },
    checks, failedChecks, failedEligibility, pendingEvidence, evidenceIssues, graphDiagnostics, missingUnitNodeIds, sensitivityProbes: probes, semanticReview: reviewResults };
}

function args(argv) {
  const result = { command: argv[0] ?? "help" };
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i];
    if (!["--case", "--evidence", "--output"].includes(key) || !argv[i + 1]) fail("Use --case, --evidence and optional --output.");
    result[key.slice(2)] = argv[i + 1];
  }
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  const options = args(argv);
  const publicSuite = await loadPublicCases();
  let result;
  if (options.command === "check") {
    const oracles = await loadOracles();
    const ids = publicSuite.cases.map((entry) => entry.id).sort();
    if (JSON.stringify(ids) !== JSON.stringify(oracles.cases.map((entry) => entry.id).sort())) fail("Public/private case coverage differs.");
    for (const entry of publicSuite.cases) for (const asset of entry.assets ?? []) await readFile(resolve(dirname(REQUESTS_PATH), asset));
    result = { ok: true, caseCount: ids.length, evaluationClass: "test_assets_only", liveAgentRuns: 0, autonomyAssessed: false,
      frozenAt: new Date().toISOString(), manifest: publicSuite.cases.map((entry) => ({ caseId: entry.id, publicInputHash: publicInputHash(entry),
        oracleHash: privateOracleHash(oracles.cases.find((item) => item.id === entry.id)) })) };
  } else if (["request", "grade"].includes(options.command)) {
    const entry = publicSuite.cases.find((item) => item.id === options.case);
    if (!entry) fail("Select an existing --case.");
    if (options.command === "request") result = agentInputForCase(entry);
    else {
      if (!options.evidence) fail("grade requires a captured --evidence file.");
      const oracle = (await loadOracles()).cases.find((item) => item.id === entry.id);
      result = assessAgentCase(entry, oracle, JSON.parse(await readFile(resolve(options.evidence), "utf8")));
    }
  } else {
    process.stdout.write("Agent business evaluation (does not start a provider):\n  check\n  request --case <id> [--output <file>]\n  grade --case <id> --evidence <capture.json> [--output <report.json>]\n");
    return;
  }
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) { await mkdir(dirname(resolve(options.output)), { recursive: true }); await writeFile(resolve(options.output), serialized); }
  else process.stdout.write(serialized);
  if (result.decision && result.decision !== "accepted_case_only") process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
