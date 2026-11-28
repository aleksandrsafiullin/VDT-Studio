import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import {
  calculateGraph, calculateScenario, evaluateModelReadiness, getExcelWorkbookCells, WORKSPACE_MODEL_READINESS_POLICY_VERSION
} from "../packages/vdt-core/src/index.ts";

const suite = new URL("../eval/agent-autonomy/", import.meta.url);
const requireCore = createRequire(new URL("../packages/vdt-core/package.json", import.meta.url));
const { strFromU8, unzipSync } = requireCore("fflate");
const near = (actual, expected) => Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected));
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const readJson = async (path) => JSON.parse(await readFile(new URL(path, suite), "utf8"));

const requestFiles = ["workspace-requests.v1.json", "workspace-requests.v2.json"];
const oracleFiles = ["workspace-oracles.v1.json", "workspace-oracles.v2.json"];
const locales = ["en", "ru"];

async function readSuite(path, version, marker, value) {
  const data = await readJson(path);
  if (data.schemaVersion !== version || data[marker] !== value || !Array.isArray(data.cases)) {
    throw new Error(`Invalid workspace suite: ${path}`);
  }
  const ids = new Set(data.cases.map((entry) => entry.id));
  if (ids.size !== data.cases.length || ids.has(undefined)) throw new Error(`Duplicate or missing workspace case ID: ${path}`);
  return data.cases;
}

async function loadCase(files, id, marker, value) {
  const suites = await Promise.all(files.map((path, index) => readSuite(path, index + 1, marker, value)));
  const matches = suites.flatMap((cases, index) => cases.filter((entry) => entry.id === id)
    .map((entry) => ({ entry, version: index + 1 })));
  if (matches.length !== 1) throw new Error(`Unknown or duplicate workspace case: ${id}`);
  return matches[0];
}

function allowedKeys(object, keys) {
  return object && typeof object === "object" && !Array.isArray(object)
    && Object.keys(object).every((key) => keys.includes(key));
}

function validateRequest(entry) {
  if (!allowedKeys(entry, ["id", "setup", "variants"]) || !/^[A-Z]+(?:-\d{2})?-[a-z0-9-]+$/.test(entry.id)
    || !allowedKeys(entry.variants, locales)) throw new Error(`Invalid public workspace case: ${entry.id}`);
  for (const locale of locales) {
    const variant = entry.variants[locale];
    if (!allowedKeys(variant, ["turns"]) || !Array.isArray(variant.turns) || !variant.turns.length
      || variant.turns.some((turn) => !allowedKeys(turn, ["prompt"]) || !nonempty(turn.prompt))) {
      throw new Error(`Invalid workspace request variant: ${entry.id}/${locale}`);
    }
  }
  const paths = {
    fixture: "assets/workspace-legacy-manual.v1.json",
    catalog: "assets/workspace-q01-catalog.v2.json",
  };
  if (entry.setup !== undefined && (!allowedKeys(entry.setup, [...Object.keys(paths), "eventFile"])
    || Object.entries(entry.setup).some(([key, value]) => key === "eventFile" ? !["duration-csv", "serial-xlsx"].includes(value) : paths[key] !== value))) {
    throw new Error(`Invalid public workspace setup: ${entry.id}`);
  }
}

/** Generation receives only the chosen original-language turn; callers apply
 * public setup via the normal UI and never forward the whole case as a prompt. */
export async function loadWorkspaceRequest(id, locale) {
  const { entry, version } = await loadCase(requestFiles, id, "evaluationClass", "workspace_journey");
  if (version === 1) return entry;
  validateRequest(entry);
  if (!locales.includes(locale)) throw new Error(`Select original workspace request locale: ${id}`);
  return { id, ...(entry.setup && { setup: entry.setup }), turns: entry.variants[locale].turns };
}

export async function loadWorkspaceOracle(id) {
  const { entry } = await loadCase(oracleFiles, id, "visibility", "evaluator_only");
  return entry;
}

export async function checkWorkspaceSuites() {
  const counts = [];
  const union = new Set();
  for (const [index, requestsPath] of requestFiles.entries()) {
    const version = index + 1;
    const oraclesPath = oracleFiles[index];
    const [requests, oracles] = await Promise.all([
      readSuite(requestsPath, version, "evaluationClass", "workspace_journey"),
      readSuite(oraclesPath, version, "visibility", "evaluator_only"),
    ]);
    const byId = new Map(oracles.map((oracle) => [oracle.id, oracle]));
    if (byId.size !== requests.length) throw new Error(`Workspace request/oracle count differs for v${version}`);
    for (const entry of requests) {
      const oracle = byId.get(entry.id);
      if (union.has(entry.id) || !oracle || !Array.isArray(oracle.review)
        || !oracle.review.length || !oracle.review.every(nonempty)
        || !allowedKeys(oracle.checkpoints, Object.keys(oracle.checkpoints ?? {}))) {
        throw new Error(`Invalid workspace oracle mapping: ${entry.id}`);
      }
      union.add(entry.id);
      if (version === 2) {
        validateRequest(entry);
        if (!Array.isArray(oracle.operatorActions) || !oracle.operatorActions.every(nonempty)) {
          throw new Error(`Invalid workspace operator instructions: ${entry.id}`);
        }
      }
      for (const path of [entry.setup?.fixture, entry.setup?.catalog].filter(Boolean)) {
        await readFile(new URL(path, suite));
      }
    }
    const hash = async (path) => `sha256:${createHash("sha256").update(await readFile(new URL(path, suite))).digest("hex")}`;
    counts.push({ version, caseCount: requests.length, requestHash: await hash(requestsPath), oracleHash: await hash(oraclesPath) });
  }
  return counts;
}

export function loadWorkspaceFixture() {
  return readJson("assets/workspace-legacy-manual.v1.json");
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => [key, sortJson(entry)]));
}

export function workspaceProjectHash(project) {
  // Canonical form used by the runtime finish receipt.
  return `sha256:${createHash("sha256").update(JSON.stringify(sortJson(project))).digest("hex")}`;
}

function calculationMatches(result, expected) {
  return result.errors.length === 0 && near(result.rootValue, expected);
}

function readCell(sheet, address) {
  const cell = sheet?.match(new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*>([\\s\\S]*?)</c>`))?.[1];
  const value = cell?.match(/<v>([^<]+)<\/v>/)?.[1];
  return { value: value === undefined ? undefined : Number(value), formula: cell?.match(/<f[^>]*>([^<]+)<\/f>/)?.[1] };
}

export function verifyWorkspaceWorkbook(project, savedRevisionId, scenario, workbook, downtimeId, expected) {
  if (!nonempty(savedRevisionId) || workbook?.descriptor?.revisionId !== savedRevisionId
    || workbook.descriptor.scenarioId !== scenario.id || !(workbook.bytes instanceof Uint8Array)) return false;
  try {
    const zip = unzipSync(workbook.bytes);
    const cells = getExcelWorkbookCells(project, { scenarioId: scenario.id });
    const sheet = (index) => strFromU8(zip[`xl/worksheets/sheet${index}.xml`]);
    const scenarioSheet = sheet(4);
    const source = readCell(sheet(3), cells.source[downtimeId].valueCell);
    const root = readCell(sheet(1), cells.tree[project.rootNodeId].baselineCell);
    const totals = cells.scenario.totals;
    const isFormulaValue = (address, target) => {
      const cell = readCell(scenarioSheet, address);
      return near(cell.value, target) && nonempty(cell.formula);
    };
    const overrideCell = cells.scenario.drivers[downtimeId]?.scenarioCell
      ?? cells.scenario.additionalOverrides[downtimeId]?.scenarioCell;
    const override = readCell(scenarioSheet, overrideCell);
    if (!near(override.value, scenario.overrides.find(({ nodeId }) => nodeId === downtimeId)?.value) || override.formula) {
      return false;
    }
    return near(source.value, expected.downtime) && !source.formula && near(root.value, expected.root) && nonempty(root.formula)
      && isFormulaValue(totals.baselineCell, expected.root)
      && isFormulaValue(totals.scenarioCell, expected.scenario)
      && isFormulaValue(totals.absoluteChangeCell, expected.scenario - expected.root);
  } catch {
    return false;
  }
}

function verifyModel(check, expected, observed, project) {
  const result = calculateGraph(project);
  const root = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  const structural = expected.outcome === "structural_model";
  const readiness = evaluateModelReadiness(project, {
    purpose: structural ? "structural_model" : "calculated_baseline",
    requireDerivedRoot: true,
    requireHierarchy: expected.outcome !== "saved" || !!root?.decompositionPlan
  });
  check("graph", readiness.accepted && root?.unit === expected.unit);
  const roles = Object.keys(expected.roles);
  const bindings = observed.roleBindings ?? {};
  const ids = roles.map((role) => bindings[role]);
  const nodes = ids.map((id) => project.graph.nodes.find((node) => node.id === id));
  check("bindings", new Set(ids).size === ids.length && nodes.every((node) => node && node.id !== project.rootNodeId && nonempty(node.unit)), ids.some((id) => id === undefined));
  for (const [index, role] of roles.entries()) {
    const value = expected.roles[role];
    const node = nodes[index];
    check(`source:${role}`, !!node && (value === null
      ? !node.formula && node.baselineValue == null && node.value == null && node.valueStatus === "unknown"
      : near(result.values[node.id], value)), !node);
  }

  const runProbe = (values) => calculateGraph(project, { overrides: Object.fromEntries(
    Object.entries(values).map(([role, value]) => [bindings[role], value])) });
  if (structural) {
    check("structure_unknown", result.rootValue === undefined && result.errors.every((error) => error.type === "missing_value"));
    const probe = expected.structureProbe;
    check("structure_relationship", calculationMatches(runProbe(probe.values), probe.root), ids.some((id) => id === undefined));
  } else {
    check("root", calculationMatches(result, expected.root));
  }
  for (const probe of expected.probes ?? []) {
    check(`sensitivity:${probe.role}`, calculationMatches(runProbe({ [probe.role]: probe.value }), probe.result), !bindings[probe.role]);
  }
  if (expected.effect) {
    const probe = expected.effect;
    check("effect_calculation", calculationMatches(runProbe({ [probe.role]: probe.value }), probe.result), !bindings[probe.role]);
    const effect = observed.effect;
    check("unsupported_effect", effect?.nodeId === bindings[probe.role] && effect?.unit === expected.unit
      && near(effect?.inputValue, probe.value) && near(effect?.baseline, expected.root)
      && near(effect?.simulated, probe.result) && near(effect?.delta, probe.result - expected.root)
      && effect?.claim === "modeled", !effect);
  }

  const scenario = expected.scenario && project.scenarios.find((entry) => entry.name === expected.scenario.name);
  if (expected.scenario) {
    const { role, value, result: scenarioRoot } = expected.scenario;
    const comparison = scenario && calculateScenario(project, scenario);
    check("saved_scenario", scenario?.overrides.length === 1 && scenario.overrides[0].nodeId === bindings[role]
      && near(scenario.overrides[0].value, value) && comparison.errors.length === 0
      && near(comparison.scenarioValue, scenarioRoot) && near(comparison.absoluteChange, scenarioRoot - expected.root), !bindings[role]);
  }
  if (expected.version) {
    const version = project.versions.find((entry) => entry.name === expected.version);
    check("saved_version", !!version && isDeepStrictEqual(version.projectSnapshot.graph, project.graph)
      && isDeepStrictEqual(version.projectSnapshot.scenarios, project.scenarios));
  }
  if (expected.workbook) {
    check("workbook", !!scenario && verifyWorkspaceWorkbook(project, observed.savedRevisionId, scenario, observed.workbook,
      bindings[expected.scenario.role], { downtime: expected.roles[expected.scenario.role], root: expected.root, scenario: expected.scenario.result }), !observed.workbook || !observed.savedRevisionId || !bindings[expected.scenario.role]);
  }
  if (expected.readOnly) {
    check("no_mutation", observed.startingRevision === observed.revision && isDeepStrictEqual(project, observed.startingProject),
      !observed.startingProject || observed.startingRevision === undefined);
  }
  if (expected.outcome === "structural_model" || expected.outcome === "calculated_baseline") {
    const receipt = observed.receipt;
    check("bound_finish_receipt", receipt?.state === "final_persisted" && receipt.outcome === expected.outcome
      && receipt.policyVersion === WORKSPACE_MODEL_READINESS_POLICY_VERSION
      && Number.isInteger(receipt.projectRevision) && receipt.projectRevision >= 0
      && (observed.builderRevision === undefined || receipt.projectRevision === observed.builderRevision)
      && receipt.projectHash === workspaceProjectHash(project), !receipt);
  }
}

/** Saved-state grading only. Input collection and independent semantic review
 * belong to the caller. This evaluator makes no provider qualification claim. */
export function assessWorkspaceJourney(oracle, evidence) {
  const checkpoints = {};
  let previousModel;
  for (const [name, expected] of Object.entries(oracle.checkpoints)) {
    const observed = evidence.checkpoints?.[name];
    const checks = {};
    const check = (code, ok, missing = false) => { checks[code] = missing ? "missing" : ok ? "pass" : "fail"; };
    if (expected.premise) {
      const premise = observed?.premise;
      check("business_premise", premise?.kind === expected.premise && nonempty(premise?.evidenceReference)
        && premise.status === (expected.outcome === "unresolved_premise" ? "unresolved" : "confirmed"), !premise);
    }
    if (expected.outcome === "unresolved_premise") {
      const response = observed?.clarification;
      check("unresolved_premise", ["question", "conditional_alternatives"].includes(response?.kind)
        && nonempty(response?.evidenceReference) && response?.assertedActualResult === false
        && !observed?.receipt, !response);
    } else if (!observed?.project || observed.revision === undefined) {
      check("saved_checkpoint", false, true);
    } else {
      if (previousModel) {
        check("same_project", previousModel.project.id === observed.project.id);
        check("later_revision", Number.isInteger(observed.revision) && observed.revision > previousModel.revision);
      }
      verifyModel(check, expected, observed, observed.project);
      previousModel = observed;
    }
    checkpoints[name] = { outcome: expected.outcome, checks };
  }
  if (oracle.dataGolden) {
    const data = evidence.data;
    checkpoints.data = { outcome: "data_reconciliation", checks: {
      golden: !data ? "missing" : isDeepStrictEqual(data, oracle.dataGolden) ? "pass" : "fail",
    } };
  }
  if (oracle.operatorActions) {
    const attempt = evidence.attempt;
    const checks = {};
    checks.identity = !attempt ? "missing" : Number.isInteger(attempt.number) && attempt.number >= 1
      && nonempty(attempt.id) && nonempty(attempt.locale) && locales.includes(attempt.locale)
      && (attempt.number === 1 ? !attempt.priorAttemptId : nonempty(attempt.priorAttemptId) && attempt.priorAttemptId !== attempt.id)
      && ["fixture", "live", "installed"].includes(attempt.source) ? "pass" : "fail";
    const timeline = attempt?.timeline;
    checks.operator_timeline = !timeline ? "missing" : Array.isArray(timeline) && timeline.length > 0
      && timeline.every((event, index) => Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0
        && (index === 0 || event.elapsedMs >= timeline[index - 1].elapsedMs)
        && nonempty(event.action) && nonempty(event.evidenceReference)) ? "pass" : "fail";
    checkpoints.attempt = { outcome: "attempt_capture", checks };
  }
  const review = evidence.semanticReview;
  const reviewMatches = nonempty(review?.reviewer) && review.independentOfGenerator === true
    && review.checks?.length === oracle.review.length
    && review.checks.every((entry) => ["pass", "fail"].includes(entry?.verdict) && nonempty(entry?.evidenceReference));
  const verdicts = Object.values(checkpoints).flatMap(({ checks }) => Object.values(checks));
  if (reviewMatches) verdicts.push(...review.checks.map(({ verdict }) => verdict));
  else verdicts.push("missing");
  const decision = verdicts.includes("fail") ? "failed_case" : verdicts.includes("missing") ? "needs_review" : "accepted_case_only";
  return { id: oracle.id, decision, checkpoints, reviewComplete: reviewMatches, supportsGeneralAutonomyClaim: false };
}
